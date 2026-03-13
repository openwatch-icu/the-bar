import { BrowserRouter } from 'react-router-dom'
import { AppRoutes } from './routes'

export default function AppApp() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  )
}
