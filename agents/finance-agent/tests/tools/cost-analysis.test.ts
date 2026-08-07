import { costAnalysisTool } from '../../src/tools/cost-analysis';

describe('cost-analysis tool',()=>{
  it('name',()=>{
    expect(costAnalysisTool.name).toBe('cost_analysis')
  });
  it('handler',async()=>{
    const o=await costAnalysisTool.handler({period:'2025-01'});
    expect(Array.isArray(o.categories)).toBe(true);
    expect(o.categories.length).toBeGreaterThan(0);
    expect(typeof o.totalCost).toBe('number');
    expect(typeof o.totalBudget).toBe('number')
  });
  it('categorias',async()=>{
    const o=await costAnalysisTool.handler({period:'2025-01'});
    for(const c of o.categories){
      expect(c).toHaveProperty('name');
      expect(c).toHaveProperty('amount');
      expect(c).toHaveProperty('budget')
    }
  });
  it('sumas',async()=>{
    const o=await costAnalysisTool.handler({period:'2025-01'});
    const sumAmount=o.categories.reduce((s,c)=>s+c.amount,0);
    const sumBudget=o.categories.reduce((s,c)=>s+c.budget,0);
    expect(o.totalCost).toBe(sumAmount);
    expect(o.totalBudget).toBe(sumBudget)
  });
});
