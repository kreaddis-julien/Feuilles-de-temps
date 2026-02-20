import { useState, useEffect, useCallback } from 'react';
import type { Project, ProjectsData } from '../types';
import * as api from '../api';

export default function ProjectsPage() {
  const [data, setData] = useState<ProjectsData>({ projects: [] });
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState<'client' | 'interne' | 'support'>('client');
  const [newTaskNames, setNewTaskNames] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    const d = await api.getProjects();
    setData(d);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    await api.createProject({ name: newName.trim(), category: newCategory });
    setNewName('');
    refresh();
  };

  const handleDeleteProject = async (id: string) => {
    await api.deleteProject(id);
    refresh();
  };

  const handleAddTask = async (projectId: string) => {
    const name = newTaskNames[projectId]?.trim();
    if (!name) return;
    await api.addTask(projectId, { name });
    setNewTaskNames((prev) => ({ ...prev, [projectId]: '' }));
    refresh();
  };

  const handleDeleteTask = async (projectId: string, taskId: string) => {
    await api.deleteTask(projectId, taskId);
    refresh();
  };

  const categories = ['client', 'interne', 'support'] as const;

  return (
    <div className="projects-page">
      <h1>Projets & Tâches</h1>

      <form onSubmit={handleCreateProject} className="add-project-form">
        <input
          type="text"
          placeholder="Nom du projet"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <select value={newCategory} onChange={(e) => setNewCategory(e.target.value as any)}>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <button type="submit">Ajouter</button>
      </form>

      {categories.map((cat) => {
        const projects = data.projects.filter((p) => p.category === cat);
        if (projects.length === 0) return null;
        return (
          <section key={cat}>
            <h2>{cat}</h2>
            {projects.map((project) => (
              <div key={project.id} className="project-card">
                <div className="project-header">
                  <strong>{project.name}</strong>
                  <button onClick={() => handleDeleteProject(project.id)} className="btn-danger">
                    Supprimer
                  </button>
                </div>
                <ul className="task-list">
                  {project.tasks.map((task) => (
                    <li key={task.id}>
                      {task.name}
                      <button onClick={() => handleDeleteTask(project.id, task.id)} className="btn-small-danger">
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="add-task-form">
                  <input
                    type="text"
                    placeholder="Nouvelle tâche"
                    value={newTaskNames[project.id] || ''}
                    onChange={(e) => setNewTaskNames((prev) => ({ ...prev, [project.id]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddTask(project.id); } }}
                  />
                  <button onClick={() => handleAddTask(project.id)}>+</button>
                </div>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}
