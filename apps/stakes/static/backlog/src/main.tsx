import React from 'react';
import ReactDOM from 'react-dom/client';
import { view } from '@forge/bridge';
import App from './App';

void view.theme.enable();
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
