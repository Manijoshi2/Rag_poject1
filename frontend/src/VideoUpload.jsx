import { useState, useRef, useEffect } from 'react';

export function VideoUpload({ onOpenGraph, onOpenChat }) {
  const [file, setFile] = useState(null);
  const [uploadStatus, setUploadStatus] = useState('idle'); // idle, uploading, done, error
  const [uploadStage, setUploadStage] = useState('');
  const [uploadResult, setUploadResult] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  
  // URL download section
  const [videoUrl, setVideoUrl] = useState('');
  const [urlStatus, setUrlStatus] = useState('');
  const [urlMessage, setUrlMessage] = useState('');

  // Video list
  const [videos, setVideos] = useState([]);
  const [loadingVideos, setLoadingVideos] = useState(false);

  const fileInputRef = useRef(null);

  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let isMounted = true;
    const loadVideos = async () => {
      try {
        const res = await fetch('http://localhost:8000/videos');
        if (res.ok) {
          const data = await res.json();
          if (isMounted) {
            setVideos(data.videos || []);
          }
        }
      } catch {
        // Backend notice
      } finally {
        if (isMounted) {
          setLoadingVideos(false);
        }
      }
    };

    loadVideos();
    return () => {
      isMounted = false;
    };
  }, [refreshKey]);

  const handleFileChange = (e) => {
    const selected = e.target.files?.[0];
    if (selected) {
      setFile(selected);
      setUploadStatus('idle');
      setErrorMessage('');
      setUploadResult(null);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const dropped = e.dataTransfer.files?.[0];
    if (dropped && dropped.type.startsWith('video/')) {
      setFile(dropped);
      setUploadStatus('idle');
      setErrorMessage('');
      setUploadResult(null);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleUpload = async () => {
    if (!file || uploadStatus === 'uploading') return;

    setUploadStatus('uploading');
    setUploadStage('Uploading video file to server...');
    setErrorMessage('');

    const formData = new FormData();
    formData.append('video', file);

    // Simulated stage progress indicators during long processing
    const timer1 = setTimeout(() => {
      setUploadStage('Whisper transcribing audio to text...');
    }, 2000);
    const timer2 = setTimeout(() => {
      setUploadStage('Generating embeddings & extracting Knowledge Graph entities...');
    }, 7000);
    const timer3 = setTimeout(() => {
      setUploadStage('Indexing vectors into Qdrant & writing facts to Neo4j...');
    }, 14000);

    try {
      const response = await fetch('http://localhost:8000/videos/upload', {
        method: 'POST',
        body: formData,
      });

      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Upload failed with status ${response.status}`);
      }

      const data = await response.json();
      setUploadResult(data);
      setUploadStatus('done');
      setRefreshKey((k) => k + 1);
    } catch (err) {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
      setUploadStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Unknown error during upload');
    }
  };

  const handleUrlSubmit = async (e) => {
    e.preventDefault();
    const url = videoUrl.trim();
    if (!url) return;

    setUrlStatus('processing');
    setUrlMessage('Submitting video URL to download pipeline...');

    try {
      const res = await fetch('http://localhost:8000/videos/from-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data = await res.json();
      setUrlStatus('success');
      setUrlMessage(data.message || 'URL accepted and queued for download.');
      setVideoUrl('');
    } catch (err) {
      setUrlStatus('error');
      setUrlMessage(err instanceof Error ? err.message : 'Failed to process URL');
    }
  };

  return (
    <div className="upload-view-container">
      <div className="upload-header">
        <span className="upload-badge">Hybrid RAG pipeline</span>
        <h2>Video ingestion and knowledge extraction</h2>
        <p>
          Upload your video to automatically transcribe audio with Whisper, generate embeddings with Ollama, store vector chunks in Qdrant, and construct nodes and relationships in Neo4j.
        </p>
      </div>

      <div className="upload-grid">
        {/* Drop Zone Box */}
        <div className="upload-card">
          <h3>File upload</h3>
          <div
            className={`drop-zone ${file ? 'has-file' : ''}`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*,.mp4,.mov,.mkv,.webm"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />

            <div className="drop-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="2" width="20" height="20" rx="4" />
                <path d="M10 8l6 4-6 4V8z" />
              </svg>
            </div>

            {file ? (
              <div className="file-info">
                <span className="file-name">{file.name}</span>
                <span className="file-size">
                  {(file.size / (1024 * 1024)).toFixed(2)} MB
                </span>
                <span className="file-change">Click to choose another file</span>
              </div>
            ) : (
              <div className="drop-prompt">
                <p className="prompt-primary">Drag and drop your video file here</p>
                <p className="prompt-secondary">or click to browse (.mp4, .mov, .mkv)</p>
              </div>
            )}
          </div>

          <button
            type="button"
            className="upload-submit-btn"
            disabled={!file || uploadStatus === 'uploading'}
            onClick={handleUpload}
          >
            {uploadStatus === 'uploading' ? 'Processing video...' : 'Ingest into RAG and Neo4j'}
          </button>

          {uploadStatus === 'uploading' && (
            <div className="upload-progress-box">
              <div className="progress-spinner" />
              <p className="progress-text">{uploadStage}</p>
            </div>
          )}

          {uploadStatus === 'error' && (
            <div className="upload-error-box">
              <p>Error: {errorMessage}</p>
            </div>
          )}

          {uploadStatus === 'done' && uploadResult && (
            <div className="upload-success-box">
              <div className="success-badge">Indexed</div>
              <h4>{uploadResult.filename}</h4>
              <p className="transcript-preview">
                {uploadResult.transcript
                  ? `"${uploadResult.transcript.substring(0, 180)}..."`
                  : 'Transcription indexed into Qdrant and Neo4j.'}
              </p>

              {uploadResult.graph && (
                <div className="result-graph-summary">
                  <span className="pill">
                    {uploadResult.graph.concepts?.length || 0} Concepts Extracted
                  </span>
                  <span className="pill">
                    {uploadResult.graph.relationships?.length || 0} Relationships Created
                  </span>
                </div>
              )}

              <div className="result-actions">
                <button
                  type="button"
                  className="result-btn primary"
                  onClick={onOpenGraph}
                >
                  View in knowledge graph
                </button>
                <button
                  type="button"
                  className="result-btn secondary"
                  onClick={onOpenChat}
                >
                  Ask questions in chat
                </button>
              </div>
            </div>
          )}
        </div>

        {/* YouTube / Video URL Download Box (Next Step Foundation) */}
        <div className="upload-card">
          <div className="card-badge-row">
            <h3>Download from URL</h3>
            <span className="url-badge">Scheduled pipeline</span>
          </div>
          <p className="card-desc">
            Paste a link to a YouTube video or remote MP4 file. The backend background worker will fetch, process, and attach it to your graph.
          </p>

          <form onSubmit={handleUrlSubmit} className="url-form">
            <div className="url-input-wrap">
              <input
                type="url"
                placeholder="https://www.youtube.com/watch?v=... or .mp4 link"
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
              />
            </div>
            <button
              type="submit"
              className="url-submit-btn"
              disabled={!videoUrl.trim() || urlStatus === 'processing'}
            >
              {urlStatus === 'processing' ? 'Submitting...' : 'Queue URL download'}
            </button>
          </form>

          {urlMessage && (
            <div className={`url-feedback ${urlStatus}`}>
              {urlMessage}
            </div>
          )}

          {/* Currently Indexed Videos */}
          <div className="indexed-videos-section">
            <h4>Indexed videos ({videos.length})</h4>
            {loadingVideos ? (
              <p className="loading-txt">Loading indexed videos...</p>
            ) : videos.length === 0 ? (
              <p className="empty-txt">No videos indexed yet.</p>
            ) : (
              <div className="videos-list">
                {videos.map((vid) => (
                  <div key={vid.id} className="video-item">
                    <div className="video-icon">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="5 3 19 12 5 21 5 3" />
                      </svg>
                    </div>
                    <div className="video-details">
                      <span className="video-name">{vid.filename}</span>
                      <span className="video-concepts-count">
                        {vid.concepts?.length || 0} concept nodes in graph
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
