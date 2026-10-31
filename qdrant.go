package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"strconv"
	"time"

	"github.com/qdrant/go-client/qdrant"
)

var qdrantClient *qdrant.Client

func getQdrantCollection() string {
	name := os.Getenv("QDRANT_COLLECTION")
	if name == "" {
		return "documents"
	}
	return name
}

func initQdrant() error {
	host := os.Getenv("QDRANT_HOST")
	if host == "" {
		host = "localhost"
	}

	port := 6334
	if portStr := os.Getenv("QDRANT_PORT"); portStr != "" {
		if p, err := strconv.Atoi(portStr); err == nil {
			port = p
		}
	}

	client, err := qdrant.NewClient(&qdrant.Config{
		Host: host,
		Port: port,
	})
	if err != nil {
		return fmt.Errorf("failed to create Qdrant client: %w", err)
	}

	qdrantClient = client

	collectionName := getQdrantCollection()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	exists, err := client.CollectionExists(ctx, collectionName)
	if err != nil {
		log.Printf("Qdrant connectivity notice: %v", err)
		return nil
	}

	if !exists {
		err = client.CreateCollection(ctx, &qdrant.CreateCollection{
			CollectionName: collectionName,
			VectorsConfig: qdrant.NewVectorsConfig(&qdrant.VectorParams{
				Size:     768,
				Distance: qdrant.Distance_Cosine,
			}),
		})
		if err != nil {
			return fmt.Errorf("failed to create collection '%s': %w", collectionName, err)
		}
		log.Printf("collection '%s' created", collectionName)
	}

	return nil
}

func closeQdrant() {
	if qdrantClient != nil {
		qdrantClient.Close()
	}
}

func generatePointID() uint64 {
	return uint64(time.Now().UnixMicro())
}
