/**
 * @file Folder.ts
 * @description Sequelize model definition for the folders table, representing nested folder structures within teams.
 * @author CloudTeams
 */
export {};
// TODO: Define the Folder model, its attributes, and self-referential associations for nested folders.

// ============================================================
// src/models/SharedLink.ts
// ============================================================
import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface SharedLinkAttributes {
  id: number;
  file_id: number;
  token: string;              // Random unique token in the URL
  password_hash?: string | null;
  expiration_date?: Date | null;
  download_limit?: number | null;
  downloads_count: number;
  created_at?: Date;
  created_by: number;
}
interface SharedLinkCreationAttributes 
  extends Optional<SharedLinkAttributes, 'id' | 'created_at' | 'password_hash' | 'expiration_date' | 'download_limit' | 'downloads_count'> {}

class SharedLink extends Model<SharedLinkAttributes, SharedLinkCreationAttributes>
  implements SharedLinkAttributes {
  declare id: number;
  declare file_id: number;
  declare token: string;
  declare password_hash: string | null;
  declare expiration_date: Date | null;
  declare download_limit: number | null;
  declare downloads_count: number;
  declare created_at: Date;
  declare created_by: number;
}

SharedLink.init({
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  file_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'files', key: 'id' } },
  token: { type: DataTypes.STRING(255), allowNull: false, unique: true },
  password_hash: { type: DataTypes.STRING(255), allowNull: true, defaultValue: null },
  expiration_date: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
  download_limit: { type: DataTypes.INTEGER, allowNull: true, defaultValue: null },
  downloads_count: { type: DataTypes.INTEGER, defaultValue: 0, allowNull: false },
  created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  created_by: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' } },
}, { sequelize, tableName: 'shared_links', timestamps: false });

export default SharedLink;