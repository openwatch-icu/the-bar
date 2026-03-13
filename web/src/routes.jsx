import { Routes, Route } from 'react-router-dom'
import { ChatApp } from './ChatApp'
import { ErrorBoundary } from './components/ErrorBoundary'

export function AppRoutes() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/" element={<ChatApp />} />
        <Route path="/:instanceSlug" element={<ChatApp />} />
      </Routes>
    </ErrorBoundary>
  )
}
