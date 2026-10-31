package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
)

type TranscriberResponse struct {
	Filename   string  `json:"filename"`
	Language   string  `json:"language"`
	Duration   float64 `json:"duration"`
	Transcript string  `json:"transcript"`
}

func transcribeVideo(file io.Reader, filename string) (string, error) {
	transcriberURL := os.Getenv("TRANSCRIBER_URL")
	if transcriberURL == "" {
		transcriberURL = "http://transcriber:5000"
	}

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", filename)
	if err != nil {
		return "", err
	}
	if _, err := io.Copy(part, file); err != nil {
		return "", err
	}
	writer.Close()

	req, err := http.NewRequest(http.MethodPost, transcriberURL+"/transcribe", &body)
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("transcriber unreachable: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBytes, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("transcriber error (%d): %s", resp.StatusCode, string(respBytes))
	}

	var result TranscriberResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}

	return result.Transcript, nil
}
