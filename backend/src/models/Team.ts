/**
 * @file Team.ts
 * @description Sequelize model definition for the teams table, representing collaboration workspaces in CloudTeams.
 * @author CloudTeams
 */

// TODO: Define the Team model, its attributes, and associations with users and other entities.

export {};
import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface TeamAttributes {
  id: number;
  name: string;
  owner_id: number;  // FK → users.id — who created the team
  description?: string | null;
  created_at?: Date;
}

interface TeamCreationAttributes 
  extends Optional<TeamAttributes, 'id' | 'created_at' | 'description'> {}

class Team extends Model<TeamAttributes, TeamCreationAttributes>
  implements TeamAttributes {
  declare id: number;
  declare name: string;
  declare owner_id: number;
  declare description: string | null;
  declare created_at: Date;
}

Team.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING(255), allowNull: false },
    owner_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      // WHY references?: This creates a FOREIGN KEY constraint in PostgreSQL.
      // If you try to delete a user who owns a team, PostgreSQL will
      // BLOCK it — preventing orphaned teams with no owner.
      references: { model: 'users', key: 'id' },
    },
    description: { type: DataTypes.TEXT, allowNull: true, defaultValue: null },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  { sequelize, tableName: 'teams', timestamps: false }
);

export default Team;
