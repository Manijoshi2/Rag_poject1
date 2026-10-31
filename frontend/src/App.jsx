import { useState, useRef, useEffect, useCallback } from 'react';
import { DotPattern } from './DotPattern';
import { GraphView } from './GraphView';
import { VideoUpload } from './VideoUpload';
import './App.css';

export default function App() {
  const [activeTab, setActiveTab] = useState('chat'); // 'chat' | 'graph' | 'upload'
  const [isLight, setIsLight] = useState(false);
  const [input, setInput] = useState('');
  const [inputHeight, setInputHeight] = useState(52);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const [messages, setMessages] = useState([]);

  const textareaRef = useRef(null);
  const scrollAnchorRef = useRef(null);
  const isDraggingRef = useRef(false);
  const startDragRef = useRef({ y: 0, height: 52 });

  useEffect(() => {
    if (activeTab === 'chat') {
      scrollAnchorRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, status, activeTab]);

  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    isDraggingRef.current = true;
    startDragRef.current = { y: e.clientY, height: inputHeight };

    const handleMouseMove = (event) => {
      if (!isDraggingRef.current) return;
      const deltaY = event.clientY - startDragRef.current.y;
      setInputHeight(Math.max(48, Math.min(180, startDragRef.current.height + deltaY)));
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [inputHeight]);

  const handleReset = () => {
    setMessages([]);
    setInput('');
    setError(null);
    setStatus('idle');
    textareaRef.current?.focus();
  };

  const handleSend = async () => {
    const query = input.trim();
    if (!query || status === 'loading') return;

    const userMessage = {
      id: Date.now().toString(),
      role: 'user',
      text: query,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setStatus('loading');
    setError(null);

    try {
      const response = await fetch('http://localhost:8000/rag/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: query }),
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      const data = await response.json();
      const assistantMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        text: data.answer || 'No answer returned.',
        sources: data.sources || [],
        graphFacts: data.graph_facts || [],
      };

      setMessages((prev) => [...prev, assistantMessage]);
      setStatus('idle');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network failure');
      setStatus('error');
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleAskAboutConcept = (conceptName) => {
    setActiveTab('chat');
    setInput(`What is ${conceptName} and how is it related to the indexed videos?`);
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 100);
  };

  return (
    <div className={`app-wrapper ${isLight ? 'light' : ''}`}>
      <DotPattern fade="radial" gap={24} dotSize={2} proximity={140} speed={1} />

      {/* Main Top Navigation Header */}
      <header className="main-navbar">
        <div className="nav-brand">
          <span className="brand-dot" />
          <span className="brand-title">GraphRAG Studio</span>
        </div>

        <nav className="tab-pill-group">
          <button
            type="button"
            className={`tab-pill ${activeTab === 'chat' ? 'active' : ''}`}
            onClick={() => setActiveTab('chat')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            Chat
          </button>

          <button
            type="button"
            className={`tab-pill ${activeTab === 'graph' ? 'active' : ''}`}
            onClick={() => setActiveTab('graph')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="6" cy="6" r="3" />
              <circle cx="18" cy="18" r="3" />
              <line x1="8.5" y1="8.5" x2="15.5" y2="15.5" />
            </svg>
            Knowledge graph
          </button>

          <button
            type="button"
            className={`tab-pill ${activeTab === 'upload' ? 'active' : ''}`}
            onClick={() => setActiveTab('upload')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            Upload video
          </button>
        </nav>

        <div className="nav-actions">
          <button
            type="button"
            className="theme-toggle-btn"
            title="Toggle theme"
            onClick={() => setIsLight((prev) => !prev)}
          >
            {isLight ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            )}
          </button>
        </div>
      </header>

      {/* Main Content Views */}
      <main className="tab-view-container">
        {activeTab === 'chat' && (
          <div className="chat-card">
            <header className="card-header">
              <div className="header-text">
                <h2>New Chat</h2>
                <p>How can I help you today?</p>
              </div>
              <div className="header-actions">
                <button
                  type="button"
                  className="icon-btn"
                  title="New conversation"
                  onClick={handleReset}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                  </svg>
                </button>
              </div>
            </header>

            <div className="chat-content">
              {messages.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z" strokeDasharray="2 3" />
                    </svg>
                  </div>
                  <h3>hello, Mani!!</h3>
                  <p>What are we working on today? Press send to start a new conversation</p>
                </div>
              ) : (
                <div className="message-stream">
                  {messages.map((msg) => (
                    <div key={msg.id} className={`message-item ${msg.role}`}>
                      <div className="bubble">{msg.text}</div>
                      {msg.graphFacts && msg.graphFacts.length > 0 && (
                        <div className="facts-row">
                          <span className="facts-label">Graph facts:</span>
                          {msg.graphFacts.slice(0, 3).map((fact, idx) => (
                            <span key={idx} className="fact-pill">
                              {fact}
                            </span>
                          ))}
                        </div>
                      )}
                      {msg.sources && msg.sources.length > 0 && (
                        <div className="sources-row">
                          {msg.sources.map((_, index) => (
                            <span key={index} className="source-tag">
                              Source #{index + 1}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  {status === 'loading' && (
                    <div className="message-item assistant">
                      <div className="typing-indicator">
                        <span className="typing-dot" />
                        <span className="typing-dot" />
                        <span className="typing-dot" />
                      </div>
                    </div>
                  )}
                </div>
              )}
              <div ref={scrollAnchorRef} />
            </div>

            <footer className="card-footer">
              <div className="input-box">
                <textarea
                  ref={textareaRef}
                  style={{ height: `${inputHeight}px` }}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="I'm building a chat for our app..."
                />
                <div
                  className="resize-dot"
                  title="Resize"
                  onMouseDown={handleMouseDown}
                />
                <div className="input-controls">
                  <button
                    type="button"
                    className="plus-btn"
                    title="Add context"
                    onClick={() => textareaRef.current?.focus()}
                  >
                    +
                  </button>
                  <button
                    type="button"
                    className="send-btn"
                    title="Send query"
                    onClick={handleSend}
                    disabled={!input.trim() || status === 'loading'}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="19" x2="12" y2="5" />
                      <polyline points="5 12 12 5 19 12" />
                    </svg>
                  </button>
                </div>
              </div>
              {error && <div className="error-banner">{error}</div>}
            </footer>
          </div>
        )}

        {activeTab === 'graph' && (
          <div className="view-card full-view">
            <GraphView isLight={isLight} onSelectConcept={handleAskAboutConcept} />
          </div>
        )}

        {activeTab === 'upload' && (
          <div className="view-card full-view">
            <VideoUpload
              onOpenGraph={() => setActiveTab('graph')}
              onOpenChat={() => setActiveTab('chat')}
            />
          </div>
        )}
      </main>
    </div>
  );
}
