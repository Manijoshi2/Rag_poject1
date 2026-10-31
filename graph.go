package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"

	"github.com/neo4j/neo4j-go-driver/v5/neo4j"
)

type GraphNode struct {
	ID       string   `json:"id"`
	Label    string   `json:"label"`
	Type     string   `json:"type"`
	X        *float64 `json:"x,omitempty"`
	Y        *float64 `json:"y,omitempty"`
	VideoID  *int     `json:"videoId,omitempty"`
	Filename *string  `json:"filename,omitempty"`
}

type GraphLink struct {
	Source   string `json:"source"`
	Target   string `json:"target"`
	Relation string `json:"relation"`
}

type FullGraphResponse struct {
	Nodes []GraphNode `json:"nodes"`
	Links []GraphLink `json:"links"`
}

type NodeCoordinateUpdate struct {
	ID string  `json:"id" binding:"required"`
	X  float64 `json:"x"`
	Y  float64 `json:"y"`
}

type CoordinatesBatchRequest struct {
	Coordinates []NodeCoordinateUpdate `json:"coordinates" binding:"required"`
}

type VideoMetadata struct {
	ID       int      `json:"id"`
	Filename string   `json:"filename"`
	Concepts []string `json:"concepts"`
}

var neo4jDriver neo4j.DriverWithContext

func initNeo4j() error {
	uri := os.Getenv("NEO4J_URI")
	if uri == "" {
		uri = "bolt://neo4j:7687"
	}
	user := os.Getenv("NEO4J_USER")
	if user == "" {
		user = "neo4j"
	}
	password := os.Getenv("NEO4J_PASSWORD")
	if password == "" {
		password = "Test@1122"
	}

	driver, err := neo4j.NewDriverWithContext(
		uri,
		neo4j.BasicAuth(user, password, ""),
	)
	if err != nil {
		return fmt.Errorf("failed to create Neo4j driver: %w", err)
	}

	ctx := context.Background()
	if err := driver.VerifyConnectivity(ctx); err != nil {
		log.Printf("Neo4j connectivity notice: %v", err)
	}

	neo4jDriver = driver
	return nil
}

func closeNeo4j() {
	if neo4jDriver != nil {
		neo4jDriver.Close(context.Background())
	}
}

func saveVideoToGraph(videoID int, filename string, graphData *GraphData) error {
	if neo4jDriver == nil {
		return fmt.Errorf("neo4j driver uninitialized")
	}

	ctx := context.Background()
	session := neo4jDriver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeWrite})
	defer session.Close(ctx)

	_, err := session.ExecuteWrite(ctx, func(tx neo4j.ManagedTransaction) (any, error) {
		cypherVideo := `
			MERGE (v:Video {id: $videoID})
			SET v.filename = $filename
			RETURN v
		`
		_, err := tx.Run(ctx, cypherVideo, map[string]any{
			"videoID":  videoID,
			"filename": filename,
		})
		if err != nil {
			return nil, err
		}

		for _, concept := range graphData.Concepts {
			concept = strings.TrimSpace(concept)
			if concept == "" {
				continue
			}
			cypherConcept := `
				MATCH (v:Video {id: $videoID})
				MERGE (c:Concept {name: $concept})
				MERGE (v)-[:MENTIONS]->(c)
			`
			_, err = tx.Run(ctx, cypherConcept, map[string]any{
				"videoID": videoID,
				"concept": concept,
			})
			if err != nil {
				return nil, err
			}
		}

		for _, rel := range graphData.Relationships {
			source := strings.TrimSpace(rel.Source)
			target := strings.TrimSpace(rel.Target)
			if source == "" || target == "" {
				continue
			}

			relType := sanitizeRelationType(rel.Relation)
			cypherRel := fmt.Sprintf(`
				MERGE (c1:Concept {name: $source})
				MERGE (c2:Concept {name: $target})
				MERGE (c1)-[:%s]->(c2)
			`, relType)

			_, err = tx.Run(ctx, cypherRel, map[string]any{
				"source": source,
				"target": target,
			})
			if err != nil {
				return nil, err
			}
		}

		return nil, nil
	})

	return err
}

func sanitizeRelationType(r string) string {
	var clean []rune
	for _, ch := range r {
		if (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || ch == '_' {
			clean = append(clean, ch)
		} else if ch == ' ' || ch == '-' {
			clean = append(clean, '_')
		}
	}
	res := strings.ToUpper(string(clean))
	if len(res) == 0 {
		return "RELATES_TO"
	}
	return res
}

func findRelevantGraphFacts(question string, docIDs []int) ([]string, error) {
	if neo4jDriver == nil {
		return nil, fmt.Errorf("neo4j driver uninitialized")
	}

	ctx := context.Background()
	session := neo4jDriver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer session.Close(ctx)

	result, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (any, error) {
		cypher := `
			OPTIONAL MATCH (c1:Concept)-[r]->(c2:Concept)
			WHERE toLower($question) CONTAINS toLower(c1.name)
			   OR toLower($question) CONTAINS toLower(c2.name)

			OPTIONAL MATCH (v:Video)-[:MENTIONS]->(vc:Concept)
			WHERE v.id IN $docIDs
			OPTIONAL MATCH (vc)-[vr]->(neighbor:Concept)

			WITH collect(DISTINCT c1.name + ' -[' + type(r) + ']-> ' + c2.name) +
			     collect(DISTINCT vc.name + ' -[' + type(vr) + ']-> ' + neighbor.name) AS allFacts
			UNWIND allFacts AS fact
			WITH fact WHERE fact IS NOT NULL AND NOT fact CONTAINS 'null'
			RETURN DISTINCT fact
			LIMIT 10
		`
		records, err := tx.Run(ctx, cypher, map[string]any{
			"question": question,
			"docIDs":   docIDs,
		})
		if err != nil {
			return nil, err
		}

		var facts []string
		for records.Next(ctx) {
			record := records.Record()
			if factVal, ok := record.Get("fact"); ok && factVal != nil {
				facts = append(facts, fmt.Sprintf("%v", factVal))
			}
		}
		return facts, records.Err()
	})

	if err != nil {
		return nil, err
	}

	if facts, ok := result.([]string); ok {
		return facts, nil
	}
	return []string{}, nil
}

func getFullGraphData() (*FullGraphResponse, error) {
	if neo4jDriver == nil {
		return nil, fmt.Errorf("neo4j driver uninitialized")
	}

	ctx := context.Background()
	session := neo4jDriver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer session.Close(ctx)

	result, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (any, error) {
		cypherNodes := `
			MATCH (n)
			WHERE n:Video OR n:Concept
			RETURN 
				CASE WHEN n:Video THEN 'video_' + toString(n.id) ELSE 'concept_' + n.name END AS id,
				CASE WHEN n:Video THEN coalesce(n.filename, 'video_' + toString(n.id)) ELSE n.name END AS label,
				labels(n)[0] AS type,
				n.id AS video_id,
				n.filename AS filename,
				n.x AS x,
				n.y AS y
		`
		records, err := tx.Run(ctx, cypherNodes, nil)
		if err != nil {
			return nil, err
		}

		var nodes []GraphNode
		for records.Next(ctx) {
			rec := records.Record()
			id, _ := rec.Get("id")
			label, _ := rec.Get("label")
			nodeType, _ := rec.Get("type")

			node := GraphNode{
				ID:    fmt.Sprintf("%v", id),
				Label: fmt.Sprintf("%v", label),
				Type:  fmt.Sprintf("%v", nodeType),
			}

			if vid, ok := rec.Get("video_id"); ok && vid != nil {
				if vNum, ok := vid.(int64); ok {
					intVal := int(vNum)
					node.VideoID = &intVal
				}
			}

			if fn, ok := rec.Get("filename"); ok && fn != nil {
				fnStr := fmt.Sprintf("%v", fn)
				node.Filename = &fnStr
			}

			if xVal, ok := rec.Get("x"); ok && xVal != nil {
				if xFloat, ok := xVal.(float64); ok {
					node.X = &xFloat
				}
			}

			if yVal, ok := rec.Get("y"); ok && yVal != nil {
				if yFloat, ok := yVal.(float64); ok {
					node.Y = &yFloat
				}
			}

			nodes = append(nodes, node)
		}
		if err := records.Err(); err != nil {
			return nil, err
		}

		cypherLinks := `
			MATCH (v:Video)-[r:MENTIONS]->(c:Concept)
			RETURN 'video_' + toString(v.id) AS source, 'concept_' + c.name AS target, type(r) AS relation
			UNION ALL
			MATCH (c1:Concept)-[r]->(c2:Concept)
			RETURN 'concept_' + c1.name AS source, 'concept_' + c2.name AS target, type(r) AS relation
		`
		linkRecords, err := tx.Run(ctx, cypherLinks, nil)
		if err != nil {
			return nil, err
		}

		var links []GraphLink
		for linkRecords.Next(ctx) {
			rec := linkRecords.Record()
			source, _ := rec.Get("source")
			target, _ := rec.Get("target")
			relation, _ := rec.Get("relation")

			links = append(links, GraphLink{
				Source:   fmt.Sprintf("%v", source),
				Target:   fmt.Sprintf("%v", target),
				Relation: fmt.Sprintf("%v", relation),
			})
		}
		if err := linkRecords.Err(); err != nil {
			return nil, err
		}

		return &FullGraphResponse{
			Nodes: nodes,
			Links: links,
		}, nil
	})

	if err != nil {
		return nil, err
	}

	if graphRes, ok := result.(*FullGraphResponse); ok {
		return graphRes, nil
	}
	return &FullGraphResponse{Nodes: []GraphNode{}, Links: []GraphLink{}}, nil
}

func updateNodeCoordinates(updates []NodeCoordinateUpdate) error {
	if neo4jDriver == nil {
		return fmt.Errorf("neo4j driver uninitialized")
	}

	ctx := context.Background()
	session := neo4jDriver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeWrite})
	defer session.Close(ctx)

	_, err := session.ExecuteWrite(ctx, func(tx neo4j.ManagedTransaction) (any, error) {
		for _, update := range updates {
			if strings.HasPrefix(update.ID, "video_") {
				vidStr := strings.TrimPrefix(update.ID, "video_")
				vid, err := strconv.Atoi(vidStr)
				if err == nil {
					cypher := `MATCH (v:Video {id: $id}) SET v.x = $x, v.y = $y`
					_, runErr := tx.Run(ctx, cypher, map[string]any{
						"id": vid,
						"x":  update.X,
						"y":  update.Y,
					})
					if runErr != nil {
						return nil, runErr
					}
				}
			} else if strings.HasPrefix(update.ID, "concept_") {
				cName := strings.TrimPrefix(update.ID, "concept_")
				cypher := `MATCH (c:Concept {name: $name}) SET c.x = $x, c.y = $y`
				_, runErr := tx.Run(ctx, cypher, map[string]any{
					"name": cName,
					"x":    update.X,
					"y":    update.Y,
				})
				if runErr != nil {
					return nil, runErr
				}
			}
		}
		return nil, nil
	})

	return err
}

func listAllVideos() ([]VideoMetadata, error) {
	if neo4jDriver == nil {
		return nil, fmt.Errorf("neo4j driver uninitialized")
	}

	ctx := context.Background()
	session := neo4jDriver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer session.Close(ctx)

	result, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (any, error) {
		cypher := `
			MATCH (v:Video)
			OPTIONAL MATCH (v)-[:MENTIONS]->(c:Concept)
			RETURN v.id AS id, coalesce(v.filename, 'document-' + toString(v.id)) AS filename, collect(DISTINCT c.name) AS concepts
			ORDER BY v.id DESC
		`
		records, err := tx.Run(ctx, cypher, nil)
		if err != nil {
			return nil, err
		}

		var videos []VideoMetadata
		for records.Next(ctx) {
			rec := records.Record()
			idVal, _ := rec.Get("id")
			fnVal, _ := rec.Get("filename")
			concVal, _ := rec.Get("concepts")

			var id int
			if num, ok := idVal.(int64); ok {
				id = int(num)
			}

			filename := fmt.Sprintf("%v", fnVal)
			var concepts []string
			if list, ok := concVal.([]any); ok {
				for _, item := range list {
					if item != nil {
						concepts = append(concepts, fmt.Sprintf("%v", item))
					}
				}
			}

			videos = append(videos, VideoMetadata{
				ID:       id,
				Filename: filename,
				Concepts: concepts,
			})
		}
		return videos, records.Err()
	})

	if err != nil {
		return nil, err
	}

	if vids, ok := result.([]VideoMetadata); ok {
		return vids, nil
	}
	return []VideoMetadata{}, nil
}
