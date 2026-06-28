export type Role = "admin" | "manager" | "user";

export interface AuthContext {
  userId: string;
  role: Role;
}

export class AuthService {
  /**
   * Verifica si el usuario puede crear una tarea del tipo especificado.
   * - admin/manager: pueden crear cron y one_time
   * - user: solo one_time
   */
  canScheduleTask(role: Role, type: "one_time" | "cron"): boolean {
    if (type === "cron" && role === "user") {
      return false;
    }
    return true;
  }

  /**
   * Verifica si el usuario puede modificar (cancelar/reprogramar) una tarea.
   * - admin: puede modificar cualquier tarea
   * - manager/user: solo las propias
   */
  canModifyTask(role: Role, taskCreatorId: string, currentUserId: string): boolean {
    if (role === "admin") {
      return true;
    }
    return taskCreatorId === currentUserId;
  }

  /**
   * Verifica si el usuario puede ver todas las tareas o solo las suyas.
   * - admin/manager: pueden ver todas
   * - user: solo las suyas
   */
  canViewAllTasks(role: Role): boolean {
    return role === "admin" || role === "manager";
  }

  /**
   * Verifica si el usuario puede ver el estado de una tarea específica.
   * - admin/manager: pueden ver cualquier estado
   * - user: solo las suyas
   */
  canViewTaskStatus(role: Role, taskCreatorId: string, currentUserId: string): boolean {
    if (role === "admin" || role === "manager") {
      return true;
    }
    return taskCreatorId === currentUserId;
  }
}
