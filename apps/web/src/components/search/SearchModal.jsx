import React, { useState, useEffect, useRef } from 'react';
import { useRouter, ROUTES } from '../../router/Router.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import Icon from '../common/Icon.jsx';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

export default function SearchModal({ isOpen, onClose, initialQuery = '' }) {
  const { user } = useAuth();
  const { navigate } = useRouter();

  const [query, setQuery] = useState(initialQuery);
  const [activeType, setActiveType] = useState('all');
  const [resultsData, setResultsData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const inputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setQuery(initialQuery);
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [isOpen, initialQuery]);

  // Debounced search query
  useEffect(() => {
    if (!isOpen) return;

    if (!query || !query.trim()) {
      setResultsData(null);
      setIsLoading(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsLoading(true);
      setError(null);
      try {
        const url = `${API_BASE}/search?q=${encodeURIComponent(query.trim())}&type=${activeType}`;
        const res = await fetch(url, {
          credentials: 'include',
          headers: { Accept: 'application/json' }
        });

        if (!res.ok) {
          throw new Error(`Search failed: HTTP ${res.status}`);
        }

        const data = await res.json();
        setResultsData(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    }, 220);

    return () => clearTimeout(timer);
  }, [query, activeType, isOpen]);

  const handleResultClick = (url) => {
    if (!url) return;
    navigate(url);
    onClose();
  };

  const counts = resultsData?.counts || {
    all: 0,
    machines: 0,
    alerts: 0,
    workOrders: 0,
    datasets: 0,
    analysisRuns: 0
  };

  if (!isOpen) return null;

  return (
    <div className="search-modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="search-modal-container" onClick={(e) => e.stopPropagation()}>
        {/* Search Input Box */}
        <div className="search-modal-input-row">
          <Icon name="search" size={20} color="var(--primary)" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search operational records: machines, alerts, work orders, datasets, runs..."
            className="search-modal-input"
            aria-label="Search operational records"
          />
          {isLoading && <span className="search-spinner" />}
          {query && !isLoading && (
            <button
              type="button"
              className="search-clear-btn"
              onClick={() => setQuery('')}
              aria-label="Clear search"
            >
              <Icon name="close" size={16} color="var(--text-muted)" />
            </button>
          )}
          <button
            type="button"
            className="search-esc-badge"
            onClick={onClose}
            aria-label="Close search"
          >
            ESC
          </button>
        </div>

        {/* Filter Pills Bar */}
        <div className="search-filter-tabs">
          <button
            type="button"
            className={`search-tab-pill ${activeType === 'all' ? 'tab-active' : ''}`}
            onClick={() => setActiveType('all')}
          >
            All {counts.all > 0 && <span className="tab-count">{counts.all}</span>}
          </button>
          <button
            type="button"
            className={`search-tab-pill ${activeType === 'machines' ? 'tab-active' : ''}`}
            onClick={() => setActiveType('machines')}
          >
            Machines {counts.machines > 0 && <span className="tab-count">{counts.machines}</span>}
          </button>
          <button
            type="button"
            className={`search-tab-pill ${activeType === 'alerts' ? 'tab-active' : ''}`}
            onClick={() => setActiveType('alerts')}
          >
            Alerts {counts.alerts > 0 && <span className="tab-count">{counts.alerts}</span>}
          </button>
          <button
            type="button"
            className={`search-tab-pill ${activeType === 'workOrders' ? 'tab-active' : ''}`}
            onClick={() => setActiveType('workOrders')}
          >
            Work Orders {counts.workOrders > 0 && <span className="tab-count">{counts.workOrders}</span>}
          </button>
          <button
            type="button"
            className={`search-tab-pill ${activeType === 'datasets' ? 'tab-active' : ''}`}
            onClick={() => setActiveType('datasets')}
          >
            Datasets {counts.datasets > 0 && <span className="tab-count">{counts.datasets}</span>}
          </button>
          <button
            type="button"
            className={`search-tab-pill ${activeType === 'analysisRuns' ? 'tab-active' : ''}`}
            onClick={() => setActiveType('analysisRuns')}
          >
            Runs {counts.analysisRuns > 0 && <span className="tab-count">{counts.analysisRuns}</span>}
          </button>
        </div>

        {/* Method & Scope Verification Tag */}
        <div className="search-method-bar">
          <div className="method-left">
            <Icon name="shield" size={12} color="var(--primary)" />
            <span className="method-text">
              {resultsData?.searchMethod || 'Indexed Operational Record Search (Factory Scoped)'}
            </span>
          </div>
          <div className="method-right">
            <span>Scoped to: {user?.factoryId?.name || 'Local Factory'}</span>
          </div>
        </div>

        {/* Results Body */}
        <div className="search-modal-results">
          {error && (
            <div className="search-error-state">
              <Icon name="alert" size={24} color="#dc4c4c" />
              <p>Search encountered an error: {error}</p>
            </div>
          )}

          {/* Initial State / No Query */}
          {!query.trim() && (
            <div className="search-empty-prompt">
              <div className="empty-icon-wrap">
                <Icon name="search" size={28} color="var(--text-muted)" />
              </div>
              <h4 className="empty-title">Search Operational Equipment & Logs</h4>
              <p className="empty-desc">
                Find machines by code (e.g. <code>GB-104</code>), active condition alerts, maintenance work orders, uploaded datasets, or analysis runs.
              </p>
              <div className="search-suggestion-chips">
                <span className="chip-label">Quick queries:</span>
                <button
                  type="button"
                  className="search-chip"
                  onClick={() => setQuery('GB-104')}
                >
                  GB-104
                </button>
                <button
                  type="button"
                  className="search-chip"
                  onClick={() => setQuery('gearbox')}
                >
                  gearbox
                </button>
                <button
                  type="button"
                  className="search-chip"
                  onClick={() => setQuery('warning')}
                >
                  warning alerts
                </button>
                <button
                  type="button"
                  className="search-chip"
                  onClick={() => setQuery('CWRU')}
                >
                  CWRU dataset
                </button>
              </div>
            </div>
          )}

          {/* Zero Results State */}
          {query.trim() && !isLoading && resultsData && resultsData.results.length === 0 && (
            <div className="search-zero-results">
              <Icon name="alert" size={28} color="var(--text-muted)" />
              <h4>No matching records found</h4>
              <p>
                No operational records matching <strong>"{query}"</strong> were found within your authorized scope (
                {user?.factoryId?.name || 'Local Plant'}).
              </p>
              <p className="zero-tips">
                Try searching for machine codes (<code>GB-104</code>, <code>PUMP-301</code>), alert types (<code>vibration</code>), or broaden your filter.
              </p>
            </div>
          )}

          {/* Results List */}
          {resultsData && resultsData.results.length > 0 && (
            <div className="search-results-list">
              {resultsData.results.map((item) => (
                <div
                  key={`${item.resultType}-${item.id}`}
                  className="search-result-card"
                  onClick={() => handleResultClick(item.url)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleResultClick(item.url);
                  }}
                >
                  <div className="result-type-icon-col">
                    <div className={`result-icon-box type-${item.resultType}`}>
                      <Icon
                        name={
                          item.resultType === 'machine'
                            ? 'machine'
                            : item.resultType === 'alert'
                            ? 'alert'
                            : item.resultType === 'workOrder'
                            ? 'wrench'
                            : item.resultType === 'dataset'
                            ? 'dataset'
                            : 'analysis'
                        }
                        size={16}
                        color="currentColor"
                      />
                    </div>
                  </div>

                  <div className="result-content-col">
                    <div className="result-top-line">
                      <span className="result-type-tag">{item.resultType.toUpperCase()}</span>
                      <h4 className="result-title">{item.title}</h4>
                      {item.badge && (
                        <span className={`result-badge badge-${item.badge.variant}`}>
                          {item.badge.label}
                        </span>
                      )}
                    </div>

                    <p className="result-subtitle">{item.subtitle}</p>

                    {item.excerpt && (
                      <p className="result-excerpt">{item.excerpt}</p>
                    )}

                    <div className="result-footer-meta">
                      <span className="result-factory-name">
                        <Icon name="factory" size={11} color="var(--text-muted)" />
                        {item.factory?.name || 'Assigned Factory'}
                      </span>
                      {item.date && (
                        <span className="result-date">
                          {new Date(item.date).toLocaleDateString()}
                        </span>
                      )}
                      <span className="result-nav-hint">View Record →</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

