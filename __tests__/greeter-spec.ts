import { PoolAPI } from '../src/pool-api';

test('Should greet with message', () => {
  const api = new PoolAPI('friend');
  expect(api).toBeTruthy();
});
