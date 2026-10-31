package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"regexp"
	"strings"
)

type OllamaEmbedRequest struct {
	Model  string `json:"model"`
	Prompt string `json:"prompt"`
}

type OllamaEmbedResponse struct {
	Embedding []float32 `json:"embedding"`
}

type OllamaGenerateRequest struct {
	Model  string `json:"model"`
	Prompt string `json:"prompt"`
	Stream bool   `json:"stream"`
	Format string `json:"format,omitempty"`
}

type OllamaGenerateResponse struct {
	Response string `json:"response"`
}

type GraphRelation struct {
	Source   string `json:"source"`
	Relation string `json:"relation"`
	Target   string `json:"target"`
}

type GraphData struct {
	Concepts      []string        `json:"concepts"`
	Relationships []GraphRelation `json:"relationships"`
}

var trailingCommaRegex = regexp.MustCompile(`,(\s*[}\]])`)

func getOllamaURL() string {
	url := os.Getenv("OLLAMA_URL")
	if url == "" {
		return "http://host.docker.internal:11434"
	}
	return url
}

func getEmbedding(text string) ([]float32, error) {
	model := os.Getenv("EMBEDDING_MODEL")
	if model == "" {
		model = "nomic-embed-text"
	}

	reqBody, err := json.Marshal(OllamaEmbedRequest{
		Model:  model,
		Prompt: text,
	})
	if err != nil {
		return nil, err
	}

	resp, err := http.Post(
		getOllamaURL()+"/api/embeddings",
		"application/json",
		bytes.NewBuffer(reqBody),
	)
	if err != nil {
		return nil, fmt.Errorf("ollama embeddings unreachable: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("ollama embeddings returned status %d", resp.StatusCode)
	}

	var result OllamaEmbedResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	return result.Embedding, nil
}

func generateAnswer(prompt string) (string, error) {
	return callOllamaGenerate(prompt, "")
}

func callOllamaGenerate(prompt string, format string) (string, error) {
	model := os.Getenv("LLM_MODEL")
	if model == "" {
		model = "llama3.2"
	}

	reqBody, err := json.Marshal(OllamaGenerateRequest{
		Model:  model,
		Prompt: prompt,
		Stream: false,
		Format: format,
	})
	if err != nil {
		return "", err
	}

	resp, err := http.Post(
		getOllamaURL()+"/api/generate",
		"application/json",
		bytes.NewBuffer(reqBody),
	)
	if err != nil {
		return "", fmt.Errorf("ollama generate unreachable: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("ollama generate returned status %d", resp.StatusCode)
	}

	var result OllamaGenerateResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}

	return result.Response, nil
}

func extractGraphData(transcript string) (*GraphData, error) {
	prompt := fmt.Sprintf(`You are a knowledge graph extractor. Analyze the following text and extract 5 to 10 key concepts and their factual relationships.
Return ONLY a valid JSON object matching this schema exactly:
{
  "concepts": ["Concept A", "Concept B"],
  "relationships": [
    {"source": "Concept A", "relation": "RELATES_TO", "target": "Concept B"}
  ]
}

Text to analyze:
%s`, transcript)

	rawResponse, err := callOllamaGenerate(prompt, "json")
	if err != nil {
		return nil, err
	}

	cleaned := strings.TrimSpace(rawResponse)
	if idx := strings.Index(cleaned, "{"); idx != -1 {
		cleaned = cleaned[idx:]
	}
	if idx := strings.LastIndex(cleaned, "}"); idx != -1 {
		cleaned = cleaned[:idx+1]
	}

	cleaned = trailingCommaRegex.ReplaceAllString(cleaned, "$1")

	var data GraphData
	if err := json.Unmarshal([]byte(cleaned), &data); err != nil {
		log.Printf("Graph JSON parse failure: %v (raw: %s)", err, rawResponse)
		return nil, fmt.Errorf("graph JSON parse failure: %w", err)
	}

	return &data, nil
}
