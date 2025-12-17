import { IsNotEmpty, IsString, IsNumber } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ConnectGmailDto {
  @ApiProperty({ description: 'Redirect URI used in frontend' })
  @IsString()
  @IsNotEmpty()
  redirectUri: string;
}

export class GoogleCallbackDto {
  @ApiProperty({ description: 'Auth code from Google' })
  @IsString()
  @IsNotEmpty()
  code: string;

  @ApiProperty({ description: 'Redirect URI used' })
  @IsString()
  @IsNotEmpty()
  redirectUri: string;
}

export class ManualSyncDto {
  @ApiProperty({ description: 'Email address to sync' })
  @IsString()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ description: 'Number of days to look back' })
  @IsNumber()
  days: number;
}

export class ConnectOutlookDto {
  @ApiProperty({ description: 'Redirect URI used in frontend' })
  @IsString()
  @IsNotEmpty()
  redirectUri: string;
}

export class OutlookCallbackDto {
  @ApiProperty({ description: 'Auth code from Microsoft' })
  @IsString()
  @IsNotEmpty()
  code: string;

  @ApiProperty({ description: 'Redirect URI used' })
  @IsString()
  @IsNotEmpty()
  redirectUri: string;
}
