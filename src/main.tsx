import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './lib/auth'
import { AgencyProvider } from './lib/agencyContext'
import { SubscriptionAccessProvider } from './lib/subscriptionAccessContext'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <AgencyProvider>
          <SubscriptionAccessProvider>
            <App />
          </SubscriptionAccessProvider>
        </AgencyProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
