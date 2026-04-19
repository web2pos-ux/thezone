/**
 * Full <App /> render is not run here: SalesPage (and others) use import.meta.url for Workers,
 * which Jest/babel in CRA 5 does not transform. Use E2E or a shallow test with heavy mocks for App.
 */
describe('frontend ci smoke', () => {
  it('jest runs', () => {
    expect(1 + 1).toBe(2);
  });
});

export {};
