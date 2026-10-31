package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/neo4j/neo4j-go-driver/v5/neo4j"
)

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
