import { useState, useRef, useEffect } from 'react';

export function VideoUpload({ onOpenGraph, onOpenChat }) {
  const [file, setFile] = useState(null);
  const [uploadStatus, setUploadStatus] = useState('idle');
  const [uploadStage, setUploadStage] = useState('');
  const [uploadResult, setUploadResult] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');

  const [videoUrl, setVideoUrl] = useState('');
  const [urlStatus, setUrlStatus] = useState('');
  const [urlMessage, setUrlMessage] = useState('');

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
    setUploadStage('Uploading...');
    setErrorMessage('');

    const formData = new FormData();
    formData.append('video', file);

    const timer1 = setTimeout(() => {
      setUploadStage('Transcribing...');
    }, 2000);
    const timer2 = setTimeout(() => {
      setUploadStage('Embedding...');
    }, 7000);
    const timer3 = setTimeout(() => {
      setUploadStage('Graphing...');
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
        throw new Error(errData.error || `Failed: ${response.status}`);
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
      setErrorMessage(err instanceof Error ? err.message : 'Error');
    }
  };

  const handleUrlSubmit = async (e) => {
    e.preventDefault();
    const url = videoUrl.trim();
    if (!url) return;

    setUrlStatus('processing');
    setUrlMessage('Queuing...');

    try {
      const res = await fetch('http://localhost:8000/videos/from-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      if (!res.ok) throw new Error(`${res.status}`);
      setUrlStatus('success');
      setUrlMessage('Queued');
      setVideoUrl('');
    } catch (err) {
      setUrlStatus('error');
      setUrlMessage(err instanceof Error ? err.message : 'Failed');
    }
  };

  return (
    <div className="upload-view-container">
      <div className="upload-header minimal">
        <h2>Video upload</h2>
      </div>

      <div className="upload-grid">
        {/* File upload card */}
        <div className="upload-card">
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
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="2" width="20" height="20" rx="4" />
                <path d="M10 8l6 4-6 4V8z" />
              </svg>
            </div>

            {file ? (
              <div className="file-info">
                <span className="file-name">{file.name}</span>
                <span className="file-size">
                  {(file.size / (1024 * 1024)).toFixed(1)} MB
                </span>
              </div>
            ) : (
              <div className="drop-prompt">
                <p className="prompt-primary">Drop video</p>
                <p className="prompt-secondary">MP4, MOV, MKV</p>
              </div>
            )}
          </div>

          <button
            type="button"
            className="upload-submit-btn"
            disabled={!file || uploadStatus === 'uploading'}
            onClick={handleUpload}
          >
            {uploadStatus === 'uploading' ? uploadStage : 'Ingest'}
          </button>

          {uploadStatus === 'uploading' && (
            <div className="upload-progress-box">
              <div className="progress-spinner" />
              <p className="progress-text">{uploadStage}</p>
            </div>
          )}

          {uploadStatus === 'error' && (
            <div className="upload-error-box">
              <p>{errorMessage}</p>
            </div>
          )}

          {uploadStatus === 'done' && uploadResult && (
            <div className="upload-success-box">
              <span className="success-badge">Indexed</span>
              <h4>{uploadResult.filename}</h4>

              {uploadResult.graph && (
                <div className="result-graph-summary">
                  <span className="pill">
                    {uploadResult.graph.concepts?.length || 0} concepts
                  </span>
                  <span className="pill">
                    {uploadResult.graph.relationships?.length || 0} relations
                  </span>
                </div>
              )}

              <div className="result-actions">
                <button
                  type="button"
                  className="result-btn primary"
                  onClick={onOpenGraph}
                >
                  Graph
                </button>
                <button
                  type="button"
                  className="result-btn secondary"
                  onClick={onOpenChat}
                >
                  Chat
                </button>
              </div>
            </div>
          )}
        </div>

        {/* URL and Indexed list card */}
        <div className="upload-card">
          <h3>URL import</h3>
          <form onSubmit={handleUrlSubmit} className="url-form">
            <div className="url-input-wrap">
              <input
                type="url"
                placeholder="YouTube or video link"
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
              />
            </div>
            <button
              type="submit"
              className="url-submit-btn"
              disabled={!videoUrl.trim() || urlStatus === 'processing'}
            >
              {urlStatus === 'processing' ? 'Queueing...' : 'Import'}
            </button>
          </form>

          {urlMessage && (
            <div className={`url-feedback ${urlStatus}`}>
              {urlMessage}
            </div>
          )}

          <div className="indexed-videos-section">
            <h4>Indexed ({videos.length})</h4>
            {loadingVideos ? (
              <p className="loading-txt">Loading...</p>
            ) : videos.length === 0 ? (
              <p className="empty-txt">None</p>
            ) : (
              <div className="videos-list">
                {videos.map((vid) => (
                  <div key={vid.id} className="video-item">
                    <div className="video-icon">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="5 3 19 12 5 21 5 3" />
                      </svg>
                    </div>
                    <div className="video-details">
                      <span className="video-name">{vid.filename}</span>
                      <span className="video-concepts-count">
                        {vid.concepts?.length || 0} concepts
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
