import { Router } from 'express';
import {
    listUsers, createUser, deleteUser, toggleUser,
    type UserRole,
} from '../../storage/userStore.js';

export const usersRouter = Router();

const ROLES: UserRole[] = ['admin', 'development', 'hr', 'sales', 'finance', 'devops'];

usersRouter.get('/', (_req, res) => {
    const users = listUsers();
    res.render('users', {
        title: 'Gestión de usuarios',
        users,
        roles: ROLES,
        error: null,
        success: null,
    });
});

usersRouter.post('/', async (req, res) => {
    const { username, password, role, name, department } = req.body as {
        username: string; password: string; role: UserRole;
        name?: string; department?: string;
    };

    if (!username || !password || !role) {
        return res.render('users', {
            title: 'Gestión de usuarios',
            users: listUsers(), roles: ROLES,
            error: 'Username, contraseña y rol son requeridos.',
            success: null,
        });
    }

    try {
        await createUser({ username, password, role, name, department });
        res.render('users', {
            title: 'Gestión de usuarios',
            users: listUsers(), roles: ROLES,
            error: null,
            success: `Usuario "${username}" creado con rol "${role}".`,
        });
    } catch (err) {
        res.render('users', {
            title: 'Gestión de usuarios',
            users: listUsers(), roles: ROLES,
            error: (err as Error).message,
            success: null,
        });
    }
});

usersRouter.post('/delete/:username', (req, res) => {
    const { username } = req.params;
    if (username === 'admin') {
        return res.render('users', {
            title: 'Gestión de usuarios',
            users: listUsers(), roles: ROLES,
            error: 'No se puede eliminar al usuario admin.',
            success: null,
        });
    }
    deleteUser(username);
    res.redirect('/users');
});

usersRouter.post('/toggle/:username', (req, res) => {
    const { username } = req.params;
    const { active } = req.body as { active: string };
    toggleUser(username, active === 'true');
    res.redirect('/users');
});
