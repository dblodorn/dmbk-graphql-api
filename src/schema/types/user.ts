import { builder } from '../builder.js';
import type { UserShape } from '../../context.js';

export const User = builder.objectRef<UserShape>('User').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    email: t.exposeString('email'),
    name: t.exposeString('name'),
    role: t.exposeString('role'),
  }),
});
