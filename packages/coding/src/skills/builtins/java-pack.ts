import type { Skill } from '@bk/agent-core';

/**
 * Java / Spring Boot skill pack (@bk-java).
 * Activated for projects with pom.xml or build.gradle.
 */
export const JAVA_PACK_SKILLS: Skill[] = [
    {
        name: 'spring-layered-architecture',
        version: '1.0.0',
        description: 'Spring Boot layered architecture: Controller â†’ Service â†’ Repository',
        scope: 'pack',
        pack: '@bk-java',
        language: ['java'],
        triggers: [
            'spring', 'springboot', 'spring boot', 'controller', 'service', 'repository',
            'componente', 'component', 'bean', 'inyeccion', 'injection', 'autowired',
            'rest api', 'endpoint', 'api rest',
        ],
        systemPromptAddition: `## Spring Boot Layered Architecture

### Capas (dependencias fluyen hacia abajo)
\`\`\`
Controller (@RestController)  â†  HTTP, validaciÃ³n de request, mapeo DTO
    â†“
Service (@Service)            â†  lÃ³gica de negocio, transacciones
    â†“
Repository (@Repository)      â†  acceso a datos, JPA/JDBC
    â†“
Domain (entities, value objects) â† sin dependencias de Spring
\`\`\`

### Controller â€” solo HTTP
\`\`\`java
@RestController
@RequestMapping("/api/users")
@RequiredArgsConstructor
public class UserController {
    private final UserService userService;

    @GetMapping("/{id}")
    public ResponseEntity<UserResponse> findById(@PathVariable UUID id) {
        return ResponseEntity.ok(userService.findById(id));
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public UserResponse create(@RequestBody @Valid CreateUserRequest request) {
        return userService.create(request);
    }
}
\`\`\`

### Service â€” lÃ³gica de negocio
\`\`\`java
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class UserService {
    private final UserRepository userRepository;

    public UserResponse findById(UUID id) {
        return userRepository.findById(id)
            .map(UserMapper::toResponse)
            .orElseThrow(() -> new ResourceNotFoundException("User", id));
    }

    @Transactional
    public UserResponse create(CreateUserRequest request) {
        // validaciones de negocio aquÃ­
        User user = UserMapper.fromRequest(request);
        return UserMapper.toResponse(userRepository.save(user));
    }
}
\`\`\`

### Reglas
- Nunca expongas entidades JPA directamente â€” usa DTOs (record o class)
- \`@Transactional(readOnly = true)\` a nivel de clase; \`@Transactional\` en mÃ©todos de escritura
- Usa \`@RequiredArgsConstructor\` (Lombok) para inyecciÃ³n por constructor â€” nunca \`@Autowired\` en campo
- Los controllers no llaman a repositories directamente`,
    },
    {
        name: 'spring-exception-handling',
        version: '1.0.0',
        description: 'Global exception handling with @ControllerAdvice and ProblemDetail (RFC 7807)',
        scope: 'pack',
        pack: '@bk-java',
        language: ['java'],
        triggers: [
            'exception', 'error handling', 'manejo de errores', 'controlleradvice',
            'exceptionhandler', 'problem detail', 'errorresponse', '404', '400', '500',
        ],
        systemPromptAddition: `## Spring Exception Handling

### Excepciones de dominio
\`\`\`java
public class ResourceNotFoundException extends RuntimeException {
    public ResourceNotFoundException(String resource, Object id) {
        super(resource + " not found: " + id);
    }
}

public class BusinessRuleException extends RuntimeException {
    public BusinessRuleException(String message) { super(message); }
}
\`\`\`

### Handler global (Spring 6 / Boot 3 â€” ProblemDetail RFC 7807)
\`\`\`java
@RestControllerAdvice
public class GlobalExceptionHandler extends ResponseEntityExceptionHandler {

    @ExceptionHandler(ResourceNotFoundException.class)
    ProblemDetail handleNotFound(ResourceNotFoundException ex) {
        return ProblemDetail.forStatusAndDetail(HttpStatus.NOT_FOUND, ex.getMessage());
    }

    @ExceptionHandler(BusinessRuleException.class)
    ProblemDetail handleBusiness(BusinessRuleException ex) {
        return ProblemDetail.forStatusAndDetail(HttpStatus.UNPROCESSABLE_ENTITY, ex.getMessage());
    }

    @Override
    protected ResponseEntity<Object> handleMethodArgumentNotValid(
            MethodArgumentNotValidException ex, HttpHeaders headers,
            HttpStatusCode status, WebRequest request) {
        ProblemDetail pd = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        pd.setProperty("errors", ex.getBindingResult().getFieldErrors().stream()
            .map(e -> e.getField() + ": " + e.getDefaultMessage())
            .toList());
        return ResponseEntity.badRequest().body(pd);
    }
}
\`\`\`

### Reglas
- Nunca devuelvas stack traces al cliente â€” loguÃ©alos internamente
- Usa \`ProblemDetail\` (Spring 6+) para respuestas de error estÃ¡ndar
- Las excepciones de dominio son RuntimeException â€” no checked exceptions
- Loguea con \`log.warn\` para 4xx y \`log.error\` para 5xx`,
    },
    {
        name: 'spring-testing',
        version: '1.0.0',
        description: 'JUnit 5, Mockito, @WebMvcTest and @DataJpaTest slices',
        scope: 'pack',
        pack: '@bk-java',
        language: ['java'],
        triggers: [
            'test', 'tests', 'testing', 'junit', 'mockito', 'mock', 'prueba',
            'webmvctest', 'datajpatest', 'springboottest', 'coverage', 'cobertura',
        ],
        systemPromptAddition: `## Spring Testing

### Test de servicio (puro, sin Spring)
\`\`\`java
@ExtendWith(MockitoExtension.class)
class UserServiceTest {
    @Mock UserRepository userRepository;
    @InjectMocks UserService userService;

    @Test
    void findById_whenExists_returnsUser() {
        var user = new User(UUID.randomUUID(), "ana@example.com");
        when(userRepository.findById(user.getId())).thenReturn(Optional.of(user));

        var result = userService.findById(user.getId());

        assertThat(result.email()).isEqualTo("ana@example.com");
        verify(userRepository).findById(user.getId());
    }

    @Test
    void findById_whenMissing_throwsNotFound() {
        var id = UUID.randomUUID();
        when(userRepository.findById(id)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> userService.findById(id))
            .isInstanceOf(ResourceNotFoundException.class);
    }
}
\`\`\`

### Test de controller (slice â€” solo capa HTTP)
\`\`\`java
@WebMvcTest(UserController.class)
class UserControllerTest {
    @Autowired MockMvc mockMvc;
    @MockBean UserService userService;

    @Test
    void getById_returns200() throws Exception {
        var response = new UserResponse(UUID.randomUUID(), "ana@example.com");
        when(userService.findById(any())).thenReturn(response);

        mockMvc.perform(get("/api/users/{id}", response.id()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.email").value("ana@example.com"));
    }
}
\`\`\`

### Reglas
- Prefiere unit tests de servicio (sin contexto Spring) para lÃ³gica de negocio
- Usa \`@WebMvcTest\` para HTTP layer y \`@DataJpaTest\` para repositorios â€” no \`@SpringBootTest\` para todo
- Usa AssertJ (\`assertThat\`) sobre JUnit assertions â€” mÃ¡s legible
- Nombra los tests: \`{metodo}_{condicion}_{resultado}\``,
    },
    {
        name: 'spring-jpa',
        version: '1.0.0',
        description: 'JPA entities, Spring Data repositories and transaction management',
        scope: 'pack',
        pack: '@bk-java',
        language: ['java'],
        triggers: [
            'jpa', 'hibernate', 'entity', 'entidad', 'repository', 'repositorio',
            'transaction', 'transaccion', 'query', 'jpql', 'migration', 'migracion',
            'flyway', 'liquibase', 'database', 'base de datos',
        ],
        systemPromptAddition: `## Spring Data JPA

### Entity
\`\`\`java
@Entity
@Table(name = "users")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED) // JPA requiere constructor sin args
public class User {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(nullable = false, unique = true)
    private String email;

    @CreationTimestamp
    private Instant createdAt;

    public User(String email) { // constructor de dominio
        this.email = email;
    }
}
\`\`\`

### Repository
\`\`\`java
public interface UserRepository extends JpaRepository<User, UUID> {
    Optional<User> findByEmail(String email);

    @Query("SELECT u FROM User u WHERE u.createdAt >= :since")
    List<User> findRecentUsers(@Param("since") Instant since);

    // Para updates masivos usa @Modifying + @Transactional
    @Modifying
    @Transactional
    @Query("UPDATE User u SET u.email = :email WHERE u.id = :id")
    int updateEmail(@Param("id") UUID id, @Param("email") String email);
}
\`\`\`

### Reglas
- Usa \`@NoArgsConstructor(access = PROTECTED)\` â€” JPA lo necesita pero no expongas el constructor vacÃ­o
- No uses \`@Setter\` en entidades â€” modifica el estado con mÃ©todos de dominio
- Nunca serialices entidades JPA a JSON directamente â€” usa DTOs (records)
- Migraciones con Flyway o Liquibase â€” nunca \`spring.jpa.hibernate.ddl-auto=update\` en producciÃ³n
- Fetch LAZY por defecto para colecciones (\`@OneToMany\`)`,
    },
];

