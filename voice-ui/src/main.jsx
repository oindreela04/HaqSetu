import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './voice.css';

const el = document.getElementById('voice-root');
if (el) createRoot(el).render(<App siteLang={el.dataset.lang || 'en'} loggedIn={el.dataset.loggedIn === 'true'} />);
