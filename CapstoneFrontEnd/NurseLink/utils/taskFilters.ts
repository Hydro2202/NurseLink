import type { Task } from '../types/domain';

/**
 * The task filter rules shared by the nurse Tasks page and the head nurse's
 * per-nurse view, so both always agree:
 *   - Completion wins: a completed task belongs to Completed only, whatever
 *     its priority or due date (both stay on the task and show there).
 *   - All / High / Medium / Low list unfinished tasks only.
 *   - Overdue lists unfinished tasks past their due time — flagged overdue by
 *     the server, or past due on the clock before the server has flagged it.
 */
export type TaskFilter = 'all' | 'high' | 'medium' | 'low' | 'overdue' | 'completed';

export function isTaskCompleted(task: Task): boolean {
  return task.status === 'completed';
}

/** True once an unfinished task's due date+time has passed. A task without a
 * due date (predates the field) is only overdue if the server says so. */
export function isTaskPastDue(task: Task, now: number = Date.now()): boolean {
  if (isTaskCompleted(task)) return false;
  if (task.status === 'overdue') return true;
  if (!task.dueDate || !task.dueTime) return false;
  const [y, m, d] = task.dueDate.split('-').map(Number);
  const [h, min] = task.dueTime.split(':').map(Number);
  if (!y || !m || !d || Number.isNaN(h) || Number.isNaN(min)) return false;
  return new Date(y, m - 1, d, h, min).getTime() < now;
}

export function matchesTaskFilter(task: Task, filter: TaskFilter | string, now: number = Date.now()): boolean {
  if (filter === 'completed') return isTaskCompleted(task);
  if (isTaskCompleted(task)) return false;
  switch (filter) {
    case 'high':
    case 'medium':
    case 'low':
      return task.priority === filter;
    case 'overdue':
      return isTaskPastDue(task, now);
    default:
      return true;
  }
}

/** Count per filter, from the same rules. */
export function countTasksByFilter(tasks: Task[], now: number = Date.now()): Record<TaskFilter, number> {
  const filters: TaskFilter[] = ['all', 'high', 'medium', 'low', 'overdue', 'completed'];
  return Object.fromEntries(
    filters.map((f) => [f, tasks.filter((t) => matchesTaskFilter(t, f, now)).length])
  ) as Record<TaskFilter, number>;
}
