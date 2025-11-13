export const Component = () => {
  const boo = undefined as any;
  return <div>{boo.hello}</div>;
  // throw new Error('Expected Error');
};
