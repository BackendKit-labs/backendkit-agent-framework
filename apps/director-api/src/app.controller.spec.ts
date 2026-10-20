import { Test, TestingModule } from '@nestjs/testing';

// Compila AppModule completo: necesita Postgres real. Se omite si no hay DB_HOST (p.ej. CI).
// AppModule se importa dentro del beforeAll: al cargarlo arrastra @kubernetes/client-node (ESM),
// que jest no transforma, y rompería la suite incluso estando omitida.
const describeWithDb = process.env.DB_HOST ? describe : describe.skip;

describeWithDb('AppModule', () => {
  let module: TestingModule;
  let AppModule: typeof import('./app.module').AppModule;

  beforeAll(async () => {
    ({ AppModule } = await import('./app.module'));
    module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
  });

  it('should compile without errors', () => {
    expect(module).toBeDefined();
    expect(module.get).toBeDefined();
  });

  it('should have all required modules imported', () => {
    const appModule = module.get(AppModule);
    expect(appModule).toBeInstanceOf(AppModule);
  });
});
