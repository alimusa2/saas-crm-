import React, { useEffect, useState } from 'react';
import styles from './TasksList.module.css';
import { tasksApi, type Task } from '../../lib/api';

function formatDue(iso?: string): { label: string; type: string } {
  if (!iso) return { label: 'No due date', type: 'other' };
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return { label: 'Today', type: 'today' };
  if (d.toDateString() === tomorrow.toDateString()) return { label: 'Tomorrow', type: 'tomorrow' };
  return { label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), type: 'other' };
}

interface TasksListProps {
  initialTasks?: Task[];
}

export const TasksList: React.FC<TasksListProps> = ({ initialTasks }) => {
  const [tasks, setTasks] = useState<Task[]>(initialTasks || []);
  const [loading, setLoading] = useState(!initialTasks);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialTasks) {
      setTasks(initialTasks);
      setLoading(false);
    } else {
      tasksApi.getTasks()
        .then(setTasks)
        .catch(e => setError(e.message))
        .finally(() => setLoading(false));
    }
  }, [initialTasks]);


  const toggleTask = async (task: Task) => {
    try {
      const updated = await tasksApi.updateTask(task.id, { is_completed: !task.is_completed });
      setTasks(prev => prev.map(t => t.id === task.id ? updated : t));
    } catch {}
  };

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <h2 className={styles.title}>Tasks Due Soon</h2>
        <a href="#" className={styles.viewAll}>View all</a>
      </div>

      <div className={styles.list}>
        {loading && <div className={styles.stateMsg}>Loading tasks…</div>}
        {error && <div className={styles.errorMsg}>⚠ {error}</div>}
        {!loading && !error && tasks.length === 0 && (
          <div className={styles.stateMsg}>No tasks yet. Create your first task!</div>
        )}
        {tasks.slice(0, 5).map(task => {
          const due = formatDue(task.due_date);
          return (
            <div
              key={task.id}
              className={`${styles.taskItem} ${task.is_completed ? styles.completed : ''}`}
            >
              <div
                className={styles.taskLeft}
                onClick={() => toggleTask(task)}
                style={{ cursor: 'pointer' }}
              >
                <div className={`${styles.radio} ${task.is_completed ? styles.radioChecked : ''}`} />
                <div>
                  <div
                    className={styles.taskTitle}
                    style={{
                      textDecoration: task.is_completed ? 'line-through' : 'none',
                      color: task.is_completed ? 'var(--text-tertiary)' : 'var(--text-main)',
                    }}
                  >
                    {task.title}
                  </div>
                  <div className={styles.taskSubtitle}>{task.priority} priority</div>
                </div>
              </div>
              <div className={`${styles.taskDate} ${
                due.type === 'today' ? styles.dateToday :
                due.type === 'tomorrow' ? styles.dateTomorrow :
                styles.dateOther
              }`}>
                {due.label}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
