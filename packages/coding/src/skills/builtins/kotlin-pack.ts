import type { Skill } from '@backendkit-labs/agent-core';

/**
 * Kotlin / Android skill pack (@bk-kotlin).
 * Activated for projects with build.gradle containing kotlin plugin,
 * detected via 'kotlin' stack (same indicator as java but differentiated
 * by triggers and stack field).
 */
export const KOTLIN_PACK_SKILLS: Skill[] = [
    {
        name: 'kotlin-coroutines',
        version: '1.0.0',
        description: 'Kotlin coroutines: suspend functions, Flow, coroutine scopes and error handling',
        scope: 'pack',
        pack: '@bk-kotlin',
        language: ['kotlin'],
        triggers: [
            'coroutine', 'coroutines', 'suspend', 'flow', 'stateflow', 'sharedflow',
            'async', 'launch', 'withcontext', 'dispatcher', 'scope', 'job',
            'concurrencia', 'concurrency', 'asincrono', 'asynchronous',
        ],
        systemPromptAddition: `## Kotlin Coroutines

### Suspend functions â€” siempre en el scope correcto
\`\`\`kotlin
// Repository
suspend fun findById(id: String): User? = withContext(Dispatchers.IO) {
    db.userDao().findById(id)
}

// ViewModel
viewModelScope.launch {
    _uiState.value = UiState.Loading
    runCatching { repository.findById(id) }
        .onSuccess { _uiState.value = UiState.Success(it) }
        .onFailure { _uiState.value = UiState.Error(it.message) }
}
\`\`\`

### Flow para streams de datos
\`\`\`kotlin
// Repository â€” expone Flow
fun observeUsers(): Flow<List<User>> = db.userDao().observeAll()

// ViewModel â€” convierte a StateFlow
val users: StateFlow<List<User>> = repository.observeUsers()
    .stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5_000),
        initialValue = emptyList(),
    )
\`\`\`

### Manejo de errores en Flow
\`\`\`kotlin
repository.observeUsers()
    .catch { emit(emptyList()) }      // recupera de errores
    .collect { users -> ... }
\`\`\`

### Dispatchers
| Dispatcher | Uso |
|---|---|
| \`Dispatchers.Main\` | UI, actualizar estado |
| \`Dispatchers.IO\` | Red, disco, base de datos |
| \`Dispatchers.Default\` | CPU-intensivo (sort, parse) |

### Reglas
- Usa \`viewModelScope\` en ViewModels â€” se cancela automÃ¡ticamente al limpiar
- Usa \`lifecycleScope\` en Activities/Fragments â€” respeta el lifecycle
- Nunca uses \`GlobalScope\` â€” no se cancela automÃ¡ticamente
- Prefiere \`StateFlow\` sobre \`LiveData\` en cÃ³digo nuevo`,
    },
    {
        name: 'compose-patterns',
        version: '1.0.0',
        description: 'Jetpack Compose: composable functions, state hoisting, side effects',
        scope: 'pack',
        pack: '@bk-kotlin',
        language: ['kotlin'],
        triggers: [
            'compose', 'composable', 'jetpack compose', 'ui', 'pantalla', 'screen',
            'remember', 'state', 'recomposition', 'launchedeffect', 'sideeffect',
            'column', 'row', 'box', 'modifier', 'material', 'scaffold',
        ],
        systemPromptAddition: `## Jetpack Compose

### State hoisting â€” separa lÃ³gica de presentaciÃ³n
\`\`\`kotlin
// Stateless (reutilizable, testeable)
@Composable
fun UserCard(user: User, onDelete: () -> Unit, modifier: Modifier = Modifier) {
    Card(modifier = modifier) {
        Text(user.name)
        IconButton(onClick = onDelete) { Icon(Icons.Default.Delete, null) }
    }
}

// Stateful (pantalla completa, conectada al ViewModel)
@Composable
fun UserScreen(viewModel: UserViewModel = hiltViewModel()) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()

    when (val state = uiState) {
        is UiState.Loading -> CircularProgressIndicator()
        is UiState.Success -> UserCard(state.user, onDelete = viewModel::delete)
        is UiState.Error   -> Text("Error: \${state.message}")
    }
}
\`\`\`

### Side effects
\`\`\`kotlin
// LaunchedEffect â€” coroutine atada al lifecycle del composable
LaunchedEffect(userId) {   // se relanza si userId cambia
    viewModel.loadUser(userId)
}

// DisposableEffect â€” recursos que necesitan cleanup
DisposableEffect(Unit) {
    val callback = registerCallback()
    onDispose { callback.unregister() }
}
\`\`\`

### Modifier â€” siempre como Ãºltimo parÃ¡metro con default
\`\`\`kotlin
@Composable
fun MyComponent(
    title: String,
    modifier: Modifier = Modifier,   // convenciÃ³n de Compose
) { ... }
\`\`\`

### Reglas
- Funciones composable en PascalCase, sin retorno de valor
- Hoist el state tan arriba como sea necesario â€” no mÃ¡s
- Evita lÃ³gica de negocio en composables â€” solo UI
- Usa \`collectAsStateWithLifecycle()\` (no \`collectAsState()\`) para respetar el lifecycle`,
    },
    {
        name: 'android-architecture',
        version: '1.0.0',
        description: 'Android Clean Architecture: ViewModel + StateFlow + Repository pattern + Hilt',
        scope: 'pack',
        pack: '@bk-kotlin',
        language: ['kotlin'],
        triggers: [
            'viewmodel', 'repository', 'usecase', 'use case', 'arquitectura',
            'architecture', 'hilt', 'dependency injection', 'inyeccion', 'clean',
            'room', 'retrofit', 'navigation', 'module',
        ],
        systemPromptAddition: `## Android Clean Architecture

### Capas
\`\`\`
UI (Composables)
    â†“ observe StateFlow
ViewModel (viewModelScope)
    â†“ suspend fun / Flow
Repository (interface en domain, impl en data)
    â†“
DataSource (Room DAO / Retrofit API)
\`\`\`

### ViewModel con StateFlow
\`\`\`kotlin
@HiltViewModel
class UserViewModel @Inject constructor(
    private val userRepository: UserRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow<UiState<User>>(UiState.Loading)
    val uiState: StateFlow<UiState<User>> = _uiState.asStateFlow()

    fun loadUser(id: String) {
        viewModelScope.launch {
            _uiState.value = UiState.Loading
            userRepository.findById(id)
                .onSuccess { _uiState.value = UiState.Success(it) }
                .onFailure { _uiState.value = UiState.Error(it.message ?: "Unknown error") }
        }
    }
}

sealed class UiState<out T> {
    data object Loading : UiState<Nothing>()
    data class Success<T>(val data: T) : UiState<T>()
    data class Error(val message: String) : UiState<Nothing>()
}
\`\`\`

### Repository
\`\`\`kotlin
// Interface en domain (sin dependencias Android)
interface UserRepository {
    suspend fun findById(id: String): Result<User>
    fun observeAll(): Flow<List<User>>
}

// ImplementaciÃ³n en data
class UserRepositoryImpl @Inject constructor(
    private val dao: UserDao,
    private val api: UserApi,
) : UserRepository {
    override suspend fun findById(id: String): Result<User> = runCatching {
        dao.findById(id) ?: api.getUser(id).also { dao.insert(it) }
    }
}
\`\`\`

### Hilt modules
\`\`\`kotlin
@Module
@InstallIn(SingletonComponent::class)
abstract class RepositoryModule {
    @Binds @Singleton
    abstract fun bindUserRepo(impl: UserRepositoryImpl): UserRepository
}
\`\`\`

### Reglas
- ViewModels no importan clases Android (Context, Activity) â€” solo lÃ³gica
- Repository oculta la fuente de datos (Room vs API) â€” el ViewModel no sabe de dÃ³nde vienen los datos
- Usa \`Result<T>\` para operaciones que pueden fallar
- Room: NUNCA accedas a la base de datos desde el main thread`,
    },
    {
        name: 'kotlin-testing',
        version: '1.0.0',
        description: 'Kotlin testing: JUnit 5, MockK, Turbine for Flow, coroutine test utilities',
        scope: 'pack',
        pack: '@bk-kotlin',
        language: ['kotlin'],
        triggers: [
            'test', 'tests', 'testing', 'prueba', 'mockk', 'mock', 'turbine',
            'coroutinetest', 'junit', 'coevery', 'coassert', 'coverage',
        ],
        systemPromptAddition: `## Kotlin Testing

### Test de ViewModel con Turbine (Flow)
\`\`\`kotlin
@OptIn(ExperimentalCoroutinesApi::class)
class UserViewModelTest {
    @get:Rule val mainRule = MainCoroutineRule() // reemplaza Dispatchers.Main

    private val repository: UserRepository = mockk()
    private lateinit var viewModel: UserViewModel

    @BeforeEach fun setup() { viewModel = UserViewModel(repository) }

    @Test fun \`loadUser emits Success when repository returns user\`() = runTest {
        val user = User("1", "ana@example.com")
        coEvery { repository.findById("1") } returns Result.success(user)

        viewModel.uiState.test {
            viewModel.loadUser("1")
            assertThat(awaitItem()).isInstanceOf(UiState.Loading::class.java)
            assertThat(awaitItem()).isEqualTo(UiState.Success(user))
            cancelAndIgnoreRemainingEvents()
        }
    }
}
\`\`\`

### MainCoroutineRule (para tests con Dispatchers.Main)
\`\`\`kotlin
class MainCoroutineRule : TestWatcher() {
    val testDispatcher = UnconfinedTestDispatcher()
    override fun starting(d: Description) { Dispatchers.setMain(testDispatcher) }
    override fun finished(d: Description) { Dispatchers.resetMain() }
}
\`\`\`

### Mock con MockK
\`\`\`kotlin
val repo: UserRepository = mockk()
coEvery { repo.findById(any()) } returns Result.success(user) // suspend fun
every { repo.observeAll() } returns flowOf(listOf(user))      // Flow

coVerify { repo.findById("1") }
\`\`\`

### Reglas
- Usa \`runTest\` para tests de coroutines â€” maneja automÃ¡ticamente los dispatchers de test
- Usa Turbine para testear Flow (\`flow.test { ... }\`)
- Usa MockK (no Mockito) para mocks en Kotlin â€” soporte nativo de suspend/coroutines
- Nombra los tests con backticks: \`\`fun \`loads user when id is valid\`()\`\``,
    },
];

