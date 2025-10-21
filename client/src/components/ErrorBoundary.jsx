import React from 'react';
import { isResizeObserverError, safeLogError } from '../utils/errorHandler';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    // Обновляем состояние так, чтобы следующий рендер показал fallback UI
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    // Игнорируем ошибки ResizeObserver, так как они не критичны
    if (isResizeObserverError(error)) {
      safeLogError(error, 'ErrorBoundary');
      return;
    }
    
    // Логируем остальные ошибки
    safeLogError(error, 'ErrorBoundary');
    this.setState({
      error: error,
      errorInfo: errorInfo
    });
  }

  render() {
    if (this.state.hasError) {
      // Fallback UI
      return (
        <div style={{
          padding: '20px',
          margin: '20px',
          border: '1px solid #f85149',
          borderRadius: '8px',
          backgroundColor: '#0d1117',
          color: '#c9d1d9'
        }}>
          <h2 style={{ color: '#f85149', marginTop: 0 }}>Что-то пошло не так</h2>
          <p>Произошла ошибка в приложении. Пожалуйста, обновите страницу.</p>
          <details style={{ marginTop: '10px' }}>
            <summary style={{ cursor: 'pointer', color: '#58a6ff' }}>
              Подробности ошибки
            </summary>
            <pre style={{ 
              marginTop: '10px', 
              padding: '10px', 
              backgroundColor: '#161b22', 
              borderRadius: '4px',
              overflow: 'auto',
              fontSize: '12px'
            }}>
              {this.state.error && this.state.error.toString()}
              {this.state.errorInfo.componentStack}
            </pre>
          </details>
          <button 
            onClick={() => window.location.reload()}
            style={{
              marginTop: '10px',
              padding: '8px 16px',
              backgroundColor: '#238636',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer'
            }}
          >
            Обновить страницу
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
