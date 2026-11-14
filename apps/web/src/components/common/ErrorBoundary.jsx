import React from 'react';
import Card from './Card.jsx';
import AlertCallout from './AlertCallout.jsx';
import Button from './Button.jsx';
import Icon from './Icon.jsx';

/**
 * Robust React Error Boundary for MechGuard AI
 * Catches unhandled render errors in child components and displays
 * a clear industrial error recovery screen instead of a blank page.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null
    };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[MechGuard ErrorBoundary Caught]', error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReload = () => {
    window.location.reload();
  };

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="page-container" style={{ padding: '2rem 1.5rem', maxWidth: 900, margin: '0 auto' }}>
          <Card title="Interface Component Exception">
            <AlertCallout
              severity="critical"
              title="A UI Rendering Error Occurred"
              description={
                this.state.error?.message ||
                'An unexpected condition occurred while rendering this view. The application caught the exception to prevent a blank screen.'
              }
              action={
                <div style={{ display: 'flex', gap: 10, marginTop: '0.5rem', flexWrap: 'wrap' }}>
                  <Button variant="primary" onClick={this.handleReload} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Icon name="refresh" size={14} />
                    <span>Reload Page</span>
                  </Button>
                  <Button variant="secondary" onClick={this.handleReset} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Icon name="arrowLeft" size={14} />
                    <span>Attempt Recovery</span>
                  </Button>
                  <Button variant="outline" onClick={() => { window.location.hash = '#/'; window.location.reload(); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span>Return to Overview</span>
                  </Button>
                </div>
              }
            />
            {this.state.error?.stack && (
              <details style={{ marginTop: '1rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Technical Diagnostics Stack</summary>
                <pre style={{
                  marginTop: '0.5rem',
                  padding: '0.75rem',
                  background: '#f8fafc',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '6px',
                  overflowX: 'auto',
                  fontFamily: 'monospace',
                  whiteSpace: 'pre-wrap'
                }}>
                  {this.state.error.stack}
                </pre>
              </details>
            )}
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}

