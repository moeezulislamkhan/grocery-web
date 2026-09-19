# app/routes/employees.py
from flask import Blueprint, request, jsonify, current_app

from app.db import query_one, query_all, execute
from app.sessions import get_session_user, role_allowed
from app.auth import hash_password

bp = Blueprint('employees', __name__, url_prefix='/api/employees')


@bp.get('')
def list_employees():
    """List all employee accounts (admin only)."""
    db = current_app.get_db()
    user = get_session_user(db, request)
    if not role_allowed(user, ['admin']):
        return jsonify(error='Admin access required.'), 403

    # Get all users with role 'employee'
    employees = query_all(db, 'SELECT id, name, email, role, created_at FROM users WHERE role = ?', ('employee',))
    return jsonify(members=employees)


@bp.post('')
def create_employee():
    """Create a new employee account (admin only)."""
    db = current_app.get_db()
    user = get_session_user(db, request)
    if not role_allowed(user, ['admin']):
        return jsonify(error='Admin access required.'), 403

    body = request.get_json(silent=True) or {}
    name = (body.get('name') or '').strip()
    email = (body.get('email') or '').strip().lower()
    password = body.get('password') or ''

    if not name:
        return jsonify(error='Please enter the employee name.'), 400
    if not email:
        return jsonify(error='Please enter a valid email address.'), 400
    if len(password) < 8:
        return jsonify(error='Password must be at least 8 characters.'), 400

    # Check if email already exists
    existing = query_one(db, 'SELECT id FROM users WHERE email = ?', (email,))
    if existing:
        return jsonify(error='An account with this email already exists.'), 409

    # Create employee account
    cur = execute(db, 'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
                  (name, email, hash_password(password), 'employee'))
    if hasattr(db, 'commit'):
        db.commit()
    
    employee = query_one(db, 'SELECT id, name, email, role, created_at FROM users WHERE id = ?', (cur.lastrowid,))
    return jsonify(employee=employee), 201


@bp.delete('/<int:employee_id>')
def delete_employee(employee_id):
    """Delete an employee account (admin only)."""
    db = current_app.get_db()
    user = get_session_user(db, request)
    if not role_allowed(user, ['admin']):
        return jsonify(error='Admin access required.'), 403

    employee = query_one(db, 'SELECT id, role FROM users WHERE id = ?', (employee_id,))
    if not employee:
        return jsonify(error='Employee not found.'), 404
    
    if employee['role'] != 'employee':
        return jsonify(error='Can only delete employee accounts.'), 400

    execute(db, 'DELETE FROM users WHERE id = ?', (employee_id,))
    if hasattr(db, 'commit'):
        db.commit()
    
    return jsonify(success=True)
