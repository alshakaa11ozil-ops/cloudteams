/**
 * @file Folder.ts
 * @description Sequelize model definition for the folders table, representing nested folder structures within teams.
 * @author CloudTeams
 */

// TODO: Define the Folder model, its attributes, and self-referential associations for nested folders.

export {};
import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface FolderAttributes {
  id: number;
  team_id: number;
  parent_folder_id?: number | null;  // null = root folder
  name: string;
  created_by: number;
  created_at?: Date;
}

interface FolderCreationAttributes 
  extends Optional<FolderAttributes, 'id' | 'created_at' | 'parent_folder_id'> {}

class Folder extends Model<FolderAttributes, FolderCreationAttributes>
  implements FolderAttributes {
  declare id: number;
  declare team_id: number;
  declare parent_folder_id: number | null;
  declare name: string;
  declare created_by: number;
  declare created_at: Date;
}

Folder.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    team_id: {
      type: DataTypes.INTEGER, allowNull: false,
      references: { model: 'teams', key: 'id' },
    },
    parent_folder_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: null,
      // WHY self-referencing FK?: A folder can be inside another folder.
      // This column points to another row in THE SAME TABLE.
      // This is called a "self-referential relationship" — it's how
      // tree structures work in relational databases.
      references: { model: 'folders', key: 'id' },
    },
    name: { type: DataTypes.STRING(255), allowNull: false },
    created_by: {
      type: DataTypes.INTEGER, allowNull: false,
      references: { model: 'users', key: 'id' },
    },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  { sequelize, tableName: 'folders', timestamps: false }
);

export default Folder;

