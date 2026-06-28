import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from './app.module';

describe('AppModule', () => {
  let module: TestingModule;

  beforeAll(async () => {
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