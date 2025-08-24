// App root: hosts the map shell and global styles
import './App.css'
import { MapView } from './components/MapView'

function App() {
  return (
    <div className="app-shell" style={{ height: '100vh', width: '100%' }}>
      <MapView />
    </div>
  )
}

export default App
