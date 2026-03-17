/**
 * @file Comment.ts
 * @description Sequelize model definition for the comments table, storing threaded discussions and @mentions on files.
 * @author CloudTeams
 */

// TODO: Define the Comment model, its attributes, and associations to files, teams, and users.

export {};
// ============================================================
// src/models/Comment.ts
// ============================================================
import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface CommentAttributes {
  id: number;
  file_id: number;
  team_id: number;
  user_id: number;
  content: string;
  created_at?: Date;
  resolved: boolean;
}
interface CommentCreationAttributes 
  extends Optional<CommentAttributes, 'id' | 'created_at' | 'resolved'> {}

class Comment extends Model<CommentAttributes, CommentCreationAttributes>
  implements CommentAttributes {
  declare id: number;
  declare file_id: number;
  declare team_id: number;
  declare user_id: number;
  declare content: string;
  declare created_at: Date;
  declare resolved: boolean;
}

Comment.init({
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  file_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'files', key: 'id' } },
  team_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'teams', key: 'id' } },
  user_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' } },
  content: { type: DataTypes.TEXT, allowNull: false },
  created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  resolved: { type: DataTypes.BOOLEAN, defaultValue: false, allowNull: false },
}, { sequelize, tableName: 'comments', timestamps: false });

export default Comment;
