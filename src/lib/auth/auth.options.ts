import { NextAuthOptions, Session } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import type { JWT } from 'next-auth/jwt';
import { decode } from 'next-auth/jwt';
import { UserModel } from '@/db/models/User.model';
import { sequelize, syncDb } from '@/db';
import SequelizeAdapter from '@auth/sequelize-adapter';
import { ModelStatic } from 'sequelize';
import { loginFormSchema } from './loginForm.schema';

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      id: 'credentials',
      name: 'Credentials',
      credentials: {
        token: { label: 'Token', type: 'text' },
      },
      async authorize(credentials) {
        if (!credentials) {
          throw new Error("Credentials don't exist!");
        }

        const creds = await decode({
          token: credentials.token,
          secret: process.env.NEXT_PUBLIC_SECRET || '',
        });

        const { email, password } = await loginFormSchema.validate(creds);

        await syncDb();
        const user = await UserModel.findOne({
          where: { email },
        });

        if (!user) {
          throw new Error(`User ${email} doesn't exist!`);
        }

        const isPasswordChecked = await user.comparePassword(password);

        if (!isPasswordChecked) {
          throw new Error(`Password for user ${email} is invalid!`);
        }

        const result = user.getPublic();
        return result;
      },
    }),
  ],
  session: {
    strategy: 'jwt',
  },
  secret: process.env.NEXTAUTH_SECRET,
  callbacks: {
    async jwt({ token, user }): Promise<JWT> {
      if (user) {
        token.role = user.role;
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }): Promise<Session> {
      const result = {
        ...session,
        user: {
          ...session.user,
          role: token.role,
          id: token.id,
        },
      };
      return result;
    },
  },
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  //@ts-ignore
  adapter: SequelizeAdapter(sequelize, {
    models: {
      User: UserModel as ModelStatic<any>,
    },
  }),
};
