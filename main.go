package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/qdrant/go-client/qdrant"
)

type DocumentRequest struct {
	Content string `json:"content" binding:"required"`
}

type RAGRequest struct {
	Question string `json:"question" binding:"required"`
}

type RAGResponse struct {
	Question   string   `json:"question"`
	Answer     string   `json:"answer"`
	Sources    []string `json:"sources"`
	GraphFacts []string `json:"graph_facts"`
}

func main() {
	if err := initQdrant(); err != nil {
		log.Fatalf("failed to initialize Qdrant: %v", err)
	}
	defer closeQdrant()

	if err := initNeo4j(); err != nil {
		log.Printf("Neo4j initialization notice: %v", err)
	}
	defer closeNeo4j()

	router := gin.Default()

	router.Use(func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization, accept, origin, Cache-Control, X-Requested-With")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS, GET, PUT, DELETE")

		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}

		c.Next()
	})

	router.POST("/documents", func(c *gin.Context) {
		var req DocumentRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "field 'content' is required"})
			return
		}

		vector, err := getEmbedding(req.Content)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "embedding failure: " + err.Error()})
			return
		}

		pointID := generatePointID()
		collectionName := getQdrantCollection()
		ctx := context.Background()

		_, err = qdrantClient.Upsert(ctx, &qdrant.UpsertPoints{
			CollectionName: collectionName,
			Points: []*qdrant.PointStruct{
				{
					Id:      qdrant.NewIDNum(pointID),
					Vectors: qdrant.NewVectors(vector...),
					Payload: qdrant.NewValueMap(map[string]any{
						"content": req.Content,
					}),
				},
			},
		})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "qdrant upsert failure: " + err.Error()})
			return
		}

		c.JSON(http.StatusCreated, gin.H{
			"id":      pointID,
			"content": req.Content,
			"message": "document indexed",
		})
	})

	router.POST("/rag/ask", func(c *gin.Context) {
		var req RAGRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "field 'question' is required"})
			return
		}

		qVector, err := getEmbedding(req.Question)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "embedding failure: " + err.Error()})
			return
		}

		limit := uint64(3)
		collectionName := getQdrantCollection()
		ctx := context.Background()

		searchResult, err := qdrantClient.Query(ctx, &qdrant.QueryPoints{
			CollectionName: collectionName,
			Query:          qdrant.NewQuery(qVector...),
			Limit:          &limit,
			WithPayload:    qdrant.NewWithPayload(true),
		})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "qdrant search failure: " + err.Error()})
			return
		}

		var docIDs []int
		var sources []string
		for _, point := range searchResult {
			if point.Id != nil {
				docIDs = append(docIDs, int(point.Id.GetNum()))
			}
			if contentVal, ok := point.Payload["content"]; ok && contentVal != nil {
				sources = append(sources, contentVal.GetStringValue())
			}
		}

		graphFacts, err := findRelevantGraphFacts(req.Question, docIDs)
		if err != nil {
			log.Printf("Neo4j fact retrieval notice: %v", err)
			graphFacts = []string{}
		}

		if len(sources) == 0 && len(graphFacts) == 0 {
			c.JSON(http.StatusOK, RAGResponse{
				Question:   req.Question,
				Answer:     "No relevant context found in documents or knowledge graph.",
				Sources:    []string{},
				GraphFacts: []string{},
			})
			return
		}

		promptWithContext := "You are an AI assistant powered by a Hybrid GraphRAG system (combining vector search with a knowledge graph).\n"
		promptWithContext += "Use BOTH the text passages and the knowledge graph facts below to answer the user's question concisely and accurately.\n\n"

		if len(sources) > 0 {
			promptWithContext += "=== CONTEXT FROM DOCUMENTS (Vector Search) ===\n"
			for i, src := range sources {
				promptWithContext += fmt.Sprintf("[%d] %s\n", i+1, src)
			}
			promptWithContext += "\n"
		}

		if len(graphFacts) > 0 {
			promptWithContext += "=== FACTS FROM KNOWLEDGE GRAPH (Neo4j) ===\n"
			for _, fact := range graphFacts {
				promptWithContext += fmt.Sprintf("* %s\n", fact)
			}
			promptWithContext += "\n"
		}

		promptWithContext += fmt.Sprintf("Question: %s\n\nAnswer:", req.Question)

		answer, err := generateAnswer(promptWithContext)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "ollama generation failure: " + err.Error()})
			return
		}

		c.JSON(http.StatusOK, RAGResponse{
			Question:   req.Question,
			Answer:     answer,
			Sources:    sources,
			GraphFacts: graphFacts,
		})
	})

	router.POST("/videos/upload", func(c *gin.Context) {
		fileHeader, err := c.FormFile("video")
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "video file required in form field 'video'"})
			return
		}

		file, err := fileHeader.Open()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to open uploaded video: " + err.Error()})
			return
		}
		defer file.Close()

		transcript, err := transcribeVideo(file, fileHeader.Filename)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "transcription failure: " + err.Error()})
			return
		}

		vector, err := getEmbedding(transcript)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "embedding failure: " + err.Error()})
			return
		}

		pointID := generatePointID()
		collectionName := getQdrantCollection()
		ctx := context.Background()

		_, err = qdrantClient.Upsert(ctx, &qdrant.UpsertPoints{
			CollectionName: collectionName,
			Points: []*qdrant.PointStruct{
				{
					Id:      qdrant.NewIDNum(pointID),
					Vectors: qdrant.NewVectors(vector...),
					Payload: qdrant.NewValueMap(map[string]any{
						"content":  transcript,
						"filename": fileHeader.Filename,
					}),
				},
			},
		})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "qdrant save failure: " + err.Error()})
			return
		}

		graphData, err := extractGraphData(transcript)
		if err == nil && graphData != nil {
			if err := saveVideoToGraph(int(pointID), fileHeader.Filename, graphData); err != nil {
				log.Printf("Neo4j graph write notice: %v", err)
			}
		}

		c.JSON(http.StatusCreated, gin.H{
			"id":         pointID,
			"filename":   fileHeader.Filename,
			"transcript": transcript,
			"graph":      graphData,
			"message":    "video indexed",
		})
	})

	router.POST("/graph/sync/:id", func(c *gin.Context) {
		idParam := c.Param("id")
		numID, err := strconv.ParseUint(idParam, 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "document ID parameter must be a positive integer"})
			return
		}

		ctx := context.Background()
		collectionName := getQdrantCollection()
		points, err := qdrantClient.Get(ctx, &qdrant.GetPoints{
			CollectionName: collectionName,
			Ids:            []*qdrant.PointId{qdrant.NewIDNum(numID)},
			WithPayload:    qdrant.NewWithPayload(true),
		})
		if err != nil || len(points) == 0 {
			c.JSON(http.StatusNotFound, gin.H{"error": fmt.Sprintf("document %d not found in Qdrant", numID)})
			return
		}

		point := points[0]
		contentVal, ok := point.Payload["content"]
		if !ok || contentVal == nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "document payload missing 'content'"})
			return
		}
		transcript := contentVal.GetStringValue()

		graphData, err := extractGraphData(transcript)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "graph extraction failure: " + err.Error()})
			return
		}

		if err := saveVideoToGraph(int(numID), fmt.Sprintf("document-%d", numID), graphData); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "neo4j write failure: " + err.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"id":      numID,
			"graph":   graphData,
			"message": "document synced",
		})
	})

	router.Run(":8000")
}
