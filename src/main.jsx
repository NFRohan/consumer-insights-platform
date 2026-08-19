import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import './styles/index.css';

// SPA-redirect fallback: if 404.html bounced us to / with the original path
// stashed in sessionStorage, replace history so React Router lands on it.
(() => {
  try {
    const target = sessionStorage.getItem('spa-redirect');
    if (target && target !== window.location.pathname + window.location.search + window.location.hash) {
      sessionStorage.removeItem('spa-redirect');
      window.history.replaceState(null, '', target);
    } else if (target) {
      sessionStorage.removeItem('spa-redirect');
    }
  } catch {
    /* sessionStorage unavailable — ignore */
  }
})();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
