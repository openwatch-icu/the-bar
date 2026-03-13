import { Component } from 'react'

/**
 * Error boundary: catches render and lifecycle errors in the subtree so the app
 * doesn't crash. Shows a fallback UI and optional retry/reload.
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo)
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null })
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      const fallback = this.props.fallback
      if (typeof fallback === 'function') {
        return fallback({
          error: this.state.error,
          retry: this.handleRetry,
          reload: this.handleReload,
        })
      }
      if (fallback) {
        return fallback
      }
      return (
        <div className="error-boundary" role="alert">
          <h2>Something went wrong</h2>
          <p>An error occurred. You can try again or reload the page.</p>
          <div className="error-boundary-actions">
            <button type="button" onClick={this.handleRetry}>
              Try again
            </button>
            <button type="button" onClick={this.handleReload}>
              Reload page
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
