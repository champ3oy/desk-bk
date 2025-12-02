import { IsEmail, IsString, IsEnum, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '../../users/entities/user.entity';

export class CreateInvitationDto {
  @ApiProperty({
    description: 'Email address of the person to invite',
    example: 'agent@example.com',
  })
  @IsEmail()
  email: string;

  @ApiProperty({
    description: 'First name of the invitee',
    example: 'Jane',
  })
  @IsString()
  firstName: string;

  @ApiProperty({
    description: 'Last name of the invitee',
    example: 'Agent',
  })
  @IsString()
  lastName: string;

  @ApiProperty({
    description: 'Role to assign to the user',
    enum: UserRole,
    example: UserRole.AGENT,
  })
  @IsEnum(UserRole)
  role: UserRole;
}

