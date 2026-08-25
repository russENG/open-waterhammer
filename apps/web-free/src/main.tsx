import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { isEmbedded } from './lib/embed-protection.ts'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isEmbedded()
      ? <main className="boot-screen boot-screen--error" role="alert"><span>埋め込み保護</span><h1>埋め込み表示はできません</h1><p>入力データを保護するため、Open Waterhammer は単独のタブで開いてください。</p></main>
      : <App />}
  </StrictMode>,
)
