import type { Skill } from '@bk/agent-core';

/**
 * Go skill pack (@bk-go).
 * Activated for projects with go.mod.
 */
export const GO_PACK_SKILLS: Skill[] = [
    {
        name: 'go-error-handling',
        version: '1.0.0',
        description: 'Idiomatic Go error handling: wrapping, sentinel errors, errors.Is/As',
        scope: 'pack',
        pack: '@bk-go',
        language: ['go'],
        triggers: [
            'error', 'errors', 'manejo de errores', 'error handling',
            'fmt.Errorf', 'errors.Is', 'errors.As', 'sentinel', 'wrap',
        ],
        systemPromptAddition: `## Go Error Handling

NUNCA ignores errores. Siempre verifica el valor de retorno de error.

### Wrapping (conserva la cadena de contexto)
\`\`\`go
if err != nil {
    return fmt.Errorf("userService.FindByID %q: %w", id, err)
}
\`\`\`

### Sentinel errors (errores de dominio)
\`\`\`go
var (
    ErrNotFound   = errors.New("not found")
    ErrConflict   = errors.New("conflict")
    ErrValidation = errors.New("validation failed")
)

// Verificar en el caller:
if errors.Is(err, ErrNotFound) { ... }
\`\`\`

### Errores con datos (implementar error interface)
\`\`\`go
type ValidationError struct {
    Field   string
    Message string
}
func (e *ValidationError) Error() string {
    return fmt.Sprintf("validation: %s â€” %s", e.Field, e.Message)
}

// Extraer en el caller:
var ve *ValidationError
if errors.As(err, &ve) { ... }
\`\`\`

### Reglas
- Usa \`%w\` para wrapping (permite errors.Is/As upstream)
- Usa \`%v\` solo para logging, nunca para propagar
- Los mensajes de error en minÃºscula, sin punto final
- No uses \`panic\` para errores de negocio â€” solo para invariantes rotos`,
    },
    {
        name: 'go-concurrency',
        version: '1.0.0',
        description: 'Goroutines, channels, context propagation and sync primitives',
        scope: 'pack',
        pack: '@bk-go',
        language: ['go'],
        triggers: [
            'goroutine', 'channel', 'chan', 'concurrencia', 'concurrency',
            'context', 'ctx', 'sync', 'mutex', 'waitgroup', 'select', 'timeout',
        ],
        systemPromptAddition: `## Go Concurrency

### Context â€” siempre el primer parÃ¡metro
\`\`\`go
func (s *UserService) FindByID(ctx context.Context, id string) (*User, error) {
    // Propaga ctx a toda operaciÃ³n I/O
    return s.repo.FindByID(ctx, id)
}
\`\`\`

### Timeout y cancelaciÃ³n
\`\`\`go
ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
defer cancel()
\`\`\`

### Goroutines: siempre controla el ciclo de vida
\`\`\`go
var wg sync.WaitGroup
errCh := make(chan error, len(items)) // buffered para evitar goroutine leak

for _, item := range items {
    wg.Add(1)
    go func(item Item) {
        defer wg.Done()
        if err := process(ctx, item); err != nil {
            errCh <- err
        }
    }(item)
}

wg.Wait()
close(errCh)
for err := range errCh { ... }
\`\`\`

### Select con timeout
\`\`\`go
select {
case result := <-resultCh:
    return result, nil
case <-ctx.Done():
    return nil, ctx.Err()
}
\`\`\`

### Reglas
- Nunca lances una goroutine sin controlar su ciclo de vida
- Usa canales buffered cuando el producer no debe bloquearse
- \`sync.Mutex\` para estado compartido simple; \`sync.RWMutex\` si hay muchas lecturas
- Nunca copies un Mutex â€” pÃ¡salo siempre por puntero`,
    },
    {
        name: 'go-http-server',
        version: '1.0.0',
        description: 'HTTP server patterns: handlers, middleware, routing with net/http or chi',
        scope: 'pack',
        pack: '@bk-go',
        language: ['go'],
        triggers: [
            'http', 'handler', 'middleware', 'router', 'endpoint', 'api rest',
            'net/http', 'chi', 'gin', 'echo', 'mux', 'servidor', 'server',
        ],
        systemPromptAddition: `## Go HTTP Server

### Handler con dependencias inyectadas
\`\`\`go
type UserHandler struct {
    service UserService
}

func NewUserHandler(service UserService) *UserHandler {
    return &UserHandler{service: service}
}

func (h *UserHandler) GetByID(w http.ResponseWriter, r *http.Request) {
    id := chi.URLParam(r, "id") // o r.PathValue("id") en Go 1.22+
    user, err := h.service.FindByID(r.Context(), id)
    if err != nil {
        writeError(w, err)
        return
    }
    writeJSON(w, http.StatusOK, user)
}
\`\`\`

### Middleware (adaptar al router usado)
\`\`\`go
func LoggingMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        start := time.Now()
        next.ServeHTTP(w, r)
        slog.Info("request", "method", r.Method, "path", r.URL.Path,
            "elapsed", time.Since(start))
    })
}
\`\`\`

### Helpers JSON
\`\`\`go
func writeJSON(w http.ResponseWriter, status int, v any) {
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(status)
    json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, err error) {
    switch {
    case errors.Is(err, ErrNotFound):
        writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
    case errors.Is(err, ErrValidation):
        writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
    default:
        writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal server error"})
    }
}
\`\`\`

### Reglas
- Siempre propaga \`r.Context()\` a las llamadas de servicio
- Nunca escribas al ResponseWriter despuÃ©s de llamar a otro handler
- Usa \`slog\` (stdlib Go 1.21+) para logging estructurado
- Valida y deserializa el body antes de llamar al servicio`,
    },
    {
        name: 'go-testing',
        version: '1.0.0',
        description: 'Table-driven tests, testify, interfaces for mocking',
        scope: 'pack',
        pack: '@bk-go',
        language: ['go'],
        triggers: [
            'test', 'tests', 'testing', 'prueba', 'mock', 'testify',
            'table driven', 'table-driven', 'assert', 'require', 'coverage',
        ],
        systemPromptAddition: `## Go Testing

### Table-driven tests (patrÃ³n estÃ¡ndar)
\`\`\`go
func TestUserService_FindByID(t *testing.T) {
    tests := []struct {
        name    string
        id      string
        want    *User
        wantErr error
    }{
        {name: "found", id: "1", want: &User{ID: "1"}},
        {name: "not found", id: "999", wantErr: ErrNotFound},
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            svc := NewUserService(newMockRepo(tt.want, tt.wantErr))
            got, err := svc.FindByID(context.Background(), tt.id)
            require.ErrorIs(t, err, tt.wantErr)
            assert.Equal(t, tt.want, got)
        })
    }
}
\`\`\`

### Mock via interface (sin frameworks externos)
\`\`\`go
type mockUserRepo struct {
    user *User
    err  error
}
func (m *mockUserRepo) FindByID(_ context.Context, _ string) (*User, error) {
    return m.user, m.err
}
func newMockRepo(u *User, err error) UserRepository { return &mockUserRepo{u, err} }
\`\`\`

### Subtests y helpers
\`\`\`go
func TestIntegration(t *testing.T) {
    if testing.Short() { t.Skip("skipping integration test") }
    // ...
}
\`\`\`

### Reglas
- Usa \`require\` (falla inmediato) para precondiciones; \`assert\` para verificaciones
- Define interfaces pequeÃ±as para mockear dependencias â€” no dependas de tipos concretos
- Nombres: \`Test{Tipo}_{Metodo}_{Condicion}\`
- Usa \`t.Parallel()\` en tests sin estado compartido para acelerar el suite`,
    },
];

