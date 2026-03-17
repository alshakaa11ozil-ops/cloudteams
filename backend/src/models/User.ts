/**
 * @file User.ts
 * @description Sequelize model definition for the users table, representing authenticated CloudTeams users.
 * @author CloudTeams
 */

// TODO: Define the User model, its attributes, and associations with other models.

export {};


// ============================================================
// PURPOSE: Define the Users table structure and behavior
// WHY THIS APPROACH: We extend Sequelize's Model class so we
//   get TypeScript type safety on all database operations.
//   The interface at the top tells TypeScript what fields exist.
// ============================================================

import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

// Interface: describes what a User record looks like
// WHY TWO INTERFACES: When creating a user, 'id' doesn't exist yet
//   (PostgreSQL auto-generates it). TypeScript needs to know 'id'
//   is optional at creation time but always exists after.
interface UserAttributes {
  id: number;
  email: string;
  password_hash: string;
  name: string;
  two_factor_secret?: string | null;  // null means 2FA not enabled
  created_at?: Date;
}

// 'Optional' marks which fields can be omitted when CREATING a record
// id is auto-generated, created_at is auto-set by the DB
interface UserCreationAttributes 
  extends Optional<UserAttributes, 'id' | 'created_at' | 'two_factor_secret'> {}

// The Model class is what gives us .create(), .findAll(), etc.
class User extends Model<UserAttributes, UserCreationAttributes> 
  implements UserAttributes {
  
  // These 'declare' lines tell TypeScript what type each field is
  // They don't create the columns — DataTypes below does that
  declare id: number;
  declare email: string;
  declare password_hash: string;
  declare name: string;
  declare two_factor_secret: string | null;
  declare created_at: Date;
}

// .init() is where we actually define the SQL columns
// This maps 1:1 to the CREATE TABLE statement in your schema
User.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,  // PostgreSQL generates 1, 2, 3...
      primaryKey: true,     // Unique identifier for each row
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: false,     // Required — can't create user without email
      unique: true,         // Two users can't have the same email
      validate: {
        isEmail: true,      // Sequelize validates format before saving
      },
    },
    password_hash: {
      type: DataTypes.STRING(255),
      allowNull: false,
      // WHY hash not password: We NEVER store plain passwords.
      // bcrypt hash is stored here. Even if DB is hacked, passwords
      // are safe because hashes can't be reversed.
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    two_factor_secret: {
      type: DataTypes.STRING(32),
      allowNull: true,  // null = 2FA not set up yet
      defaultValue: null,
    },
    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,  // Auto-set to current timestamp
    },
  },
  {
    sequelize,          // Use our shared connection
    tableName: 'users', // Map to the 'users' table in PostgreSQL
    timestamps: false,  // We manage created_at manually above
    // WHY timestamps: false?: Sequelize's auto timestamps use
    //   camelCase (createdAt, updatedAt). Our schema uses snake_case
    //   (created_at). Disabling auto and managing manually avoids confusion.
  }
);

export default User;