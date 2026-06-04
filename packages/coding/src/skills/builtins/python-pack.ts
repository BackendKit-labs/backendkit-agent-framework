import type { Skill } from '@backendkit-labs/agent-core';

/**
 * Python / FastAPI skill pack (@bk-python).
 * Activated for projects with requirements.txt or pyproject.toml.
 */
export const PYTHON_PACK_SKILLS: Skill[] = [
    {
        name: 'fastapi-patterns',
        version: '1.0.0',
        description: 'FastAPI patterns: routers, Depends, Pydantic models, async handlers',
        scope: 'pack',
        pack: '@bk-python',
        language: ['python'],
        triggers: [
            'fastapi', 'api', 'router', 'endpoint', 'depends', 'dependency',
            'pydantic', 'schema', 'request', 'response', 'handler', 'route',
            'api rest', 'backend', 'servidor', 'server',
        ],
        systemPromptAddition: `## FastAPI Patterns

### Router modular
\`\`\`python
# routers/users.py
from fastapi import APIRouter, Depends, HTTPException, status
from app.schemas.user import UserCreate, UserResponse
from app.services.user import UserService
from app.dependencies import get_user_service

router = APIRouter(prefix="/users", tags=["users"])

@router.get("/{user_id}", response_model=UserResponse)
async def get_user(user_id: UUID, service: UserService = Depends(get_user_service)):
    user = await service.find_by_id(user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user

@router.post("", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(data: UserCreate, service: UserService = Depends(get_user_service)):
    return await service.create(data)
\`\`\`

### Pydantic schemas (separados de las entidades ORM)
\`\`\`python
from pydantic import BaseModel, EmailStr
from uuid import UUID

class UserCreate(BaseModel):
    email: EmailStr
    name: str

class UserResponse(BaseModel):
    id: UUID
    email: str
    name: str

    model_config = {"from_attributes": True}  # para mapear desde ORM
\`\`\`

### Dependencias con Depends
\`\`\`python
# dependencies.py
async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session

async def get_user_service(db: AsyncSession = Depends(get_db)) -> UserService:
    return UserService(UserRepository(db))
\`\`\`

### Reglas
- Usa \`APIRouter\` por dominio â€” no pongas todo en \`main.py\`
- Los schemas de entrada (Create/Update) y salida (Response) son clases separadas
- Nunca devuelvas modelos ORM directamente â€” mapea a schemas Pydantic
- Usa \`status.HTTP_xxx\` en lugar de nÃºmeros crudos`,
    },
    {
        name: 'python-error-handling',
        version: '1.0.0',
        description: 'FastAPI exception handling: custom exceptions, global handlers, HTTP errors',
        scope: 'pack',
        pack: '@bk-python',
        language: ['python'],
        triggers: [
            'exception', 'error', 'manejo de errores', 'error handling',
            'httpexception', 'exceptionhandler', '404', '400', '422', '500',
            'try', 'except', 'raise',
        ],
        systemPromptAddition: `## Python / FastAPI Error Handling

### Excepciones de dominio
\`\`\`python
class AppError(Exception):
    """Base para todos los errores de la aplicaciÃ³n."""
    pass

class NotFoundError(AppError):
    def __init__(self, resource: str, id: Any):
        self.resource = resource
        self.id = id
        super().__init__(f"{resource} not found: {id}")

class ValidationError(AppError):
    def __init__(self, message: str):
        super().__init__(message)

class ConflictError(AppError):
    def __init__(self, message: str):
        super().__init__(message)
\`\`\`

### Handler global en FastAPI
\`\`\`python
# main.py
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

app = FastAPI()

@app.exception_handler(NotFoundError)
async def not_found_handler(request: Request, exc: NotFoundError):
    return JSONResponse(status_code=404, content={"detail": str(exc)})

@app.exception_handler(ConflictError)
async def conflict_handler(request: Request, exc: ConflictError):
    return JSONResponse(status_code=409, content={"detail": str(exc)})

@app.exception_handler(ValidationError)
async def validation_handler(request: Request, exc: ValidationError):
    return JSONResponse(status_code=422, content={"detail": str(exc)})
\`\`\`

### En los servicios â€” lanza excepciones de dominio
\`\`\`python
async def find_by_id(self, user_id: UUID) -> User:
    user = await self.repo.find_by_id(user_id)
    if not user:
        raise NotFoundError("User", user_id)
    return user
\`\`\`

### Reglas
- Los servicios lanzan excepciones de dominio (NotFoundError, etc.) â€” no HTTPException
- Los handlers globales convierten excepciones de dominio a respuestas HTTP
- Nunca devuelvas stack traces al cliente en producciÃ³n
- Usa logging estructurado: \`logger.exception("msg", exc_info=True)\``,
    },
    {
        name: 'sqlalchemy-patterns',
        version: '1.0.0',
        description: 'Async SQLAlchemy, repository pattern, Alembic migrations',
        scope: 'pack',
        pack: '@bk-python',
        language: ['python'],
        triggers: [
            'sqlalchemy', 'database', 'base de datos', 'orm', 'model', 'modelo',
            'migration', 'migracion', 'alembic', 'session', 'query', 'repository',
            'repositorio', 'postgresql', 'postgres', 'mysql', 'sqlite',
        ],
        systemPromptAddition: `## SQLAlchemy (Async) + Repository Pattern

### Modelo ORM
\`\`\`python
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy import String
import uuid

class Base(DeclarativeBase):
    pass

class UserModel(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    created_at: Mapped[datetime] = mapped_column(default=func.now())
\`\`\`

### Repository
\`\`\`python
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

class UserRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def find_by_id(self, user_id: UUID) -> UserModel | None:
        result = await self.session.execute(
            select(UserModel).where(UserModel.id == user_id)
        )
        return result.scalar_one_or_none()

    async def save(self, user: UserModel) -> UserModel:
        self.session.add(user)
        await self.session.flush()   # persiste en la transacciÃ³n actual
        await self.session.refresh(user)
        return user
\`\`\`

### SesiÃ³n async con context manager
\`\`\`python
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker

engine = create_async_engine(settings.DATABASE_URL)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)

# En dependencies.py
async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        async with session.begin():  # commit/rollback automÃ¡tico
            yield session
\`\`\`

### Reglas
- Usa \`async_sessionmaker\` con \`session.begin()\` para transacciones automÃ¡ticas
- Nunca expongas modelos ORM fuera del repositorio â€” mapea a schemas Pydantic
- Usa Alembic para migraciones â€” nunca \`Base.metadata.create_all()\` en producciÃ³n
- \`expire_on_commit=False\` evita lazy-loading despuÃ©s del commit`,
    },
    {
        name: 'python-testing',
        version: '1.0.0',
        description: 'pytest, fixtures, httpx AsyncClient for FastAPI integration tests',
        scope: 'pack',
        pack: '@bk-python',
        language: ['python'],
        triggers: [
            'test', 'tests', 'testing', 'pytest', 'fixture', 'mock', 'prueba',
            'async test', 'httpx', 'asyncclient', 'coverage', 'cobertura',
            'parametrize', 'conftest',
        ],
        systemPromptAddition: `## Python Testing (pytest + httpx)

### Test unitario de servicio
\`\`\`python
import pytest
from unittest.mock import AsyncMock, MagicMock
from app.services.user import UserService
from app.errors import NotFoundError

@pytest.fixture
def mock_repo():
    return MagicMock()

@pytest.fixture
def user_service(mock_repo):
    return UserService(mock_repo)

@pytest.mark.asyncio
async def test_find_by_id_returns_user(user_service, mock_repo):
    user = User(id=uuid4(), email="ana@example.com", name="Ana")
    mock_repo.find_by_id = AsyncMock(return_value=user)

    result = await user_service.find_by_id(user.id)

    assert result.email == "ana@example.com"
    mock_repo.find_by_id.assert_awaited_once_with(user.id)

@pytest.mark.asyncio
async def test_find_by_id_raises_not_found(user_service, mock_repo):
    mock_repo.find_by_id = AsyncMock(return_value=None)

    with pytest.raises(NotFoundError):
        await user_service.find_by_id(uuid4())
\`\`\`

### Test de API con httpx AsyncClient
\`\`\`python
# conftest.py
import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app

@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c

# test_users.py
@pytest.mark.asyncio
async def test_get_user_returns_200(client):
    response = await client.get(f"/users/{user_id}")
    assert response.status_code == 200
    assert response.json()["email"] == "ana@example.com"

@pytest.mark.asyncio
async def test_get_user_returns_404(client):
    response = await client.get(f"/users/{uuid4()}")
    assert response.status_code == 404
\`\`\`

### Reglas
- Usa \`pytest-asyncio\` con \`asyncio_mode = "auto"\` en \`pyproject.toml\`
- Fixtures en \`conftest.py\` â€” no en cada archivo de test
- Usa \`AsyncMock\` para mockear funciones async
- Usa \`pytest.mark.parametrize\` para casos mÃºltiples del mismo test`,
    },
];

