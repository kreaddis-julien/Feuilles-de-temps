import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import TrackerPage from './pages/TrackerPage';
import ProjectsPage from './pages/ProjectsPage';

export default function App() {
  return (
    <BrowserRouter>
      <nav>
        <NavLink to="/">Tracker</NavLink>
        <NavLink to="/projects">Projets</NavLink>
      </nav>
      <main>
        <Routes>
          <Route path="/" element={<TrackerPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}
