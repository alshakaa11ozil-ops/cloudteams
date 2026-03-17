/**
 * @file File.ts
 * @description Sequelize model definition for the files table, including soft file locking fields for collaborative editing in CloudTeams.
 * @author CloudTeams
 */

// TODO: Define the File model, its attributes (including soft lock columns), and associations to teams, folders, and versions.

export {};
import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface FileAttributes {
  id: number;
  team_id: number;
  folder_id?: number | null;
  filename: string;
  file_size: number;
  file_type?: string | null;
  hash?: string | null;       // SHA-256 hash for deduplication
  storage_path: string;

  // ⭐ SOFT FILE LOCKING COLUMNS (Feature 8 - the star feature!)
  is_being_edited: boolean;
  edited_by?: number | null;
  editing_started_at?: Date | null;

  version_number: number;
  is_deleted: boolean;
  deleted_at?: Date | null;
  deleted_by?: number | null;
  uploaded_by: number;
  uploaded_at?: Date;
}

interface FileCreationAttributes extends Optional<FileAttributes,
  | 'id' | 'uploaded_at' | 'folder_id' | 'file_type' | 'hash'
  | 'is_being_edited' | 'edited_by' | 'editing_started_at'
  | 'version_number' | 'is_deleted' | 'deleted_at' | 'deleted_by'
> {}

class File extends Model<FileAttributes, FileCreationAttributes>
  implements FileAttributes {
  declare id: number;
  declare team_id: number;
  declare folder_id: number | null;
  declare filename: string;
  declare file_size: number;
  declare file_type: string | null;
  declare hash: string | null;
  declare storage_path: string;
  declare is_being_edited: boolean;
  declare edited_by: number | null;
  declare editing_started_at: Date | null;
  declare version_number: number;
  declare is_deleted: boolean;
  declare deleted_at: Date | null;
  declare deleted_by: number | null;
  declare uploaded_by: number;
  declare uploaded_at: Date;
}

File.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    team_id: {
      type: DataTypes.INTEGER, allowNull: false,
      references: { model: 'teams', key: 'id' },
    },
    folder_id: {
      type: DataTypes.INTEGER, allowNull: true, defaultValue: null,
      references: { model: 'folders', key: 'id' },
    },
    filename: { type: DataTypes.STRING(255), allowNull: false },
    file_size: { type: DataTypes.INTEGER, allowNull: false },
    file_type: { type: DataTypes.STRING(50), allowNull: true },
    hash: {
      type: DataTypes.STRING(64),  // SHA-256 = exactly 64 hex characters
      allowNull: true,
      // WHY store hash?: For deduplication. Before saving a file,
      // we check if this hash already exists. If yes, we just create
      // a reference — never storing the same bytes twice.
    },
    storage_path: { type: DataTypes.STRING(512), allowNull: false },

    // ⭐ SOFT FILE LOCKING
    // WHY Boolean + Timestamp together?: The boolean is fast to
    //   query ("is this locked?"). The timestamp is for the cleanup
    //   job — find locks older than 2 hours and auto-release them.
    is_being_edited: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull: false,
    },
    edited_by: {
      type: DataTypes.INTEGER, allowNull: true, defaultValue: null,
      references: { model: 'users', key: 'id' },
    },
    editing_started_at: {
      type: DataTypes.DATE, allowNull: true, defaultValue: null,
    },

    version_number: {
      type: DataTypes.INTEGER,
      defaultValue: 1,
      allowNull: false,
    },

    // ⭐ SOFT DELETE
    // WHY soft delete over hard delete?: If we run DELETE FROM files,
    //   the data is gone forever. With soft delete, is_deleted=true
    //   hides it from normal queries but keeps it in the recycle bin
    //   for 30 days. Users can recover it. Accidents are reversible.
    is_deleted: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull: false,
    },
    deleted_at: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
    deleted_by: {
      type: DataTypes.INTEGER, allowNull: true, defaultValue: null,
      references: { model: 'users', key: 'id' },
    },

    uploaded_by: {
      type: DataTypes.INTEGER, allowNull: false,
      references: { model: 'users', key: 'id' },
    },
    uploaded_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  { sequelize, tableName: 'files', timestamps: false }
);

export default File;
