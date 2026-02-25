import {
  Injectable,
  Logger,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { OrganizationsService } from '../../organizations/organizations.service';
import { Model, Types } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { Client } from '@microsoft/microsoft-graph-client';
import {
  EmailIntegration,
  EmailIntegrationDocument,
  EmailIntegrationStatus,
  EmailProvider,
} from './entities/email-integration.entity';
import { GoogleCallbackDto, OutlookCallbackDto } from './dto/connect-email.dto';

@Injectable()
export class EmailIntegrationService {
  private readonly logger = new Logger(EmailIntegrationService.name);

  constructor(
    @InjectModel(EmailIntegration.name)
    private emailIntegrationModel: Model<EmailIntegrationDocument>,
    private organizationsService: OrganizationsService,
    private configService: ConfigService,
  ) {}

  private getOAuthClient(redirectUri: string): OAuth2Client {
    return new google.auth.OAuth2(
      this.configService.get<string>('GOOGLE_CLIENT_ID'),
      this.configService.get<string>('GOOGLE_CLIENT_SECRET'),
      redirectUri,
    );
  }

  /**
   * Generate Google Auth URL
   */
  getGoogleAuthUrl(redirectUri: string, state?: string): string {
    const oauth2Client = this.getOAuthClient(redirectUri);

    const scopes = [
      'https://www.googleapis.com/auth/gmail.modify',
      'email',
      'profile',
    ];

    return oauth2Client.generateAuthUrl({
      access_type: 'offline', // Crucial for refresh token
      scope: scopes,
      prompt: 'consent', // Force consent screen to ensure we get refresh token
      state,
      include_granted_scopes: true,
    });
  }

  /**
   * Generate Microsoft Outlook Auth URL
   */
  getOutlookAuthUrl(redirectUri: string, state?: string): string {
    const clientId = this.configService.get<string>('MICROSOFT_CLIENT_ID');
    const tenantId =
      this.configService.get<string>('MICROSOFT_TENANT_ID') || 'common';

    // Scopes for reading/sending mail and offline_access for refresh tokens
    const scopes = [
      'offline_access',
      'User.Read',
      'Mail.ReadWrite',
      'Mail.Send',
    ].join(' ');

    const params = new URLSearchParams({
      client_id: clientId || '',
      response_type: 'code',
      redirect_uri: redirectUri,
      response_mode: 'query',
      scope: scopes,
      state: state || '',
    });

    return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${params.toString()}`;
  }

  /**
   * Handle Outlook Callback - Exchange code for tokens
   */
  async handleOutlookCallback(
    dto: OutlookCallbackDto,
    organizationId: string,
  ): Promise<EmailIntegration> {
    const clientId = this.configService.get<string>('MICROSOFT_CLIENT_ID');
    const clientSecret = this.configService.get<string>(
      'MICROSOFT_CLIENT_SECRET',
    );
    const tenantId =
      this.configService.get<string>('MICROSOFT_TENANT_ID') || 'common';

    const params = new URLSearchParams({
      client_id: clientId || '',
      scope: 'offline_access User.Read Mail.ReadWrite Mail.Send',
      code: dto.code,
      redirect_uri: dto.redirectUri,
      grant_type: 'authorization_code',
      client_secret: clientSecret || '',
    });

    try {
      const tokenResponse = await fetch(
        `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params,
        },
      );

      const tokens = await tokenResponse.json();

      if (!tokenResponse.ok) {
        throw new Error(`Microsoft Token Error: ${JSON.stringify(tokens)}`);
      }

      // Initialize Graph Client to get User Profile
      const client = Client.init({
        authProvider: (callback) => callback(null, tokens.access_token),
      });

      const user = await client
        .api('/me')
        .select('mail,userPrincipalName')
        .get();
      const emailAddress = user.mail || user.userPrincipalName;

      if (!emailAddress) {
        throw new Error(
          'Could not retrieve email address from Microsoft profile',
        );
      }

      // Check existing
      const existing = await this.emailIntegrationModel.findOne({
        email: emailAddress,
      });

      const expiryDate = new Date();
      expiryDate.setSeconds(expiryDate.getSeconds() + tokens.expires_in);

      if (existing) {
        if (existing.organizationId.toString() !== organizationId) {
          throw new ConflictException(
            'This email is already connected to another organization',
          );
        }

        existing.accessToken = tokens.access_token;
        if (tokens.refresh_token) {
          existing.refreshToken = tokens.refresh_token;
        }
        existing.expiryDate = expiryDate;
        existing.status = EmailIntegrationStatus.ACTIVE;
        existing.isActive = true;
        existing.provider = EmailIntegrationStatus.ACTIVE
          ? EmailProvider.OUTLOOK
          : existing.provider; // Ensure provider set if migrated (unlikely)

        return await existing.save();
      }

      const integration = new this.emailIntegrationModel({
        organizationId: new Types.ObjectId(organizationId),
        email: emailAddress,
        provider: EmailProvider.OUTLOOK,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || '',
        expiryDate: expiryDate,
        scopes: tokens.scope ? tokens.scope.split(' ') : [],
        status: EmailIntegrationStatus.ACTIVE,
        isActive: true,
      });

      await integration.save();

      await this.organizationsService.addSupportEmail(
        organizationId.toString(),
        emailAddress,
      );

      return integration;
    } catch (error) {
      this.logger.error(`Failed to connect Outlook account: ${error.message}`);
      throw error;
    }
  }

  /**
   * Handle Google Callback - Exchange code for tokens
   */
  async handleGoogleCallback(
    dto: GoogleCallbackDto,
    organizationId: string,
  ): Promise<EmailIntegration> {
    const oauth2Client = this.getOAuthClient(dto.redirectUri);

    try {
      const { tokens } = await oauth2Client.getToken(dto.code);
      oauth2Client.setCredentials(tokens);

      // Get user profile to identify the email
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      const profileInfo = await gmail.users.getProfile({ userId: 'me' });

      const emailAddress = profileInfo.data.emailAddress;

      if (!emailAddress) {
        throw new Error('Could not retrieve email address from Google profile');
      }

      // Check if this email is already connected
      const existing = await this.emailIntegrationModel.findOne({
        email: emailAddress,
      });

      if (existing) {
        if (existing.organizationId.toString() !== organizationId) {
          throw new ConflictException(
            'This email is already connected to another organization',
          );
        }

        // Update existing integration
        existing.accessToken = tokens.access_token || '';
        if (tokens.refresh_token) {
          existing.refreshToken = tokens.refresh_token;
        }
        existing.expiryDate = tokens.expiry_date
          ? new Date(tokens.expiry_date)
          : undefined;
        existing.status = EmailIntegrationStatus.ACTIVE;
        existing.isActive = true;
        existing.scopes = tokens.scope ? tokens.scope.split(' ') : [];

        return await existing.save();
      }

      // Create new integration
      if (!tokens.refresh_token) {
        this.logger.warn(
          `No refresh token received for ${emailAddress}. User might have already authorized without offline access.`,
        );
      }

      const integration = new this.emailIntegrationModel({
        organizationId: new Types.ObjectId(organizationId),
        email: emailAddress,
        provider: EmailProvider.GMAIL,
        accessToken: tokens.access_token || '',
        refreshToken: tokens.refresh_token || '', // Might be undefined if not first time
        expiryDate: tokens.expiry_date
          ? new Date(tokens.expiry_date)
          : undefined,
        scopes: tokens.scope ? tokens.scope.split(' ') : [],
        historyId: profileInfo.data.historyId,
        status: EmailIntegrationStatus.ACTIVE,
        isActive: true,
      });

      await integration.save();

      // Trigger initial history setup / watch
      // TODO: Call watch method

      await this.organizationsService.addSupportEmail(
        organizationId.toString(),
        emailAddress,
      );

      return integration;
    } catch (error) {
      this.logger.error(`Failed to connect Google account: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get integration by Organization ID - includes both active and inactive
   */
  async findByOrganization(
    organizationId: string,
  ): Promise<EmailIntegration[]> {
    return this.emailIntegrationModel.find({
      organizationId: new Types.ObjectId(organizationId),
    });
  }

  /**
   * Get integration by Email
   */
  async findByEmail(email: string): Promise<EmailIntegrationDocument | null> {
    return this.emailIntegrationModel.findOne({
      email,
      isActive: true,
      status: EmailIntegrationStatus.ACTIVE,
    });
  }

  /**
   * Get integration by ID
   */
  async findById(id: string): Promise<EmailIntegrationDocument | null> {
    return this.emailIntegrationModel.findById(id).exec();
  }

  /**
   * Get all active integrations for system polling
   */
  async findAllActiveSystem(): Promise<EmailIntegrationDocument[]> {
    return this.emailIntegrationModel.find({
      isActive: true,
      status: EmailIntegrationStatus.ACTIVE,
    });
  }

  /**
   * Toggle integration active status
   */
  async toggleStatus(
    id: string,
    organizationId: string,
  ): Promise<EmailIntegration> {
    const integration = await this.emailIntegrationModel.findOne({
      _id: new Types.ObjectId(id),
      organizationId: new Types.ObjectId(organizationId),
    });

    if (!integration) {
      throw new NotFoundException('Integration not found');
    }

    integration.isActive = !integration.isActive;
    integration.status = integration.isActive
      ? EmailIntegrationStatus.ACTIVE
      : EmailIntegrationStatus.INACTIVE;

    await integration.save();

    this.logger.log(
      `Email integration ${id} ${integration.isActive ? 'activated' : 'deactivated'}`,
    );

    return integration;
  }

  /**
   * Get an authenticated full Gmail client for a specific email
   */
  async getGmailClient(email: string): Promise<{
    gmail: any;
    integration: EmailIntegrationDocument;
  }> {
    const integration = await this.findByEmail(email);
    if (!integration) {
      throw new Error(`No active integration found for email ${email}`);
    }

    const oauth2Client = new google.auth.OAuth2(
      this.configService.get<string>('GOOGLE_CLIENT_ID'),
      this.configService.get<string>('GOOGLE_CLIENT_SECRET'),
    );

    oauth2Client.setCredentials({
      access_token: integration.accessToken,
      refresh_token: integration.refreshToken,
      scope: integration.scopes.join(' '),
      expiry_date: integration.expiryDate
        ? integration.expiryDate.getTime()
        : null,
    });

    // Handle token refresh automatically
    oauth2Client.on('tokens', async (tokens) => {
      this.logger.debug(`Refreshing tokens for ${email}`);
      if (tokens.access_token) {
        integration.accessToken = tokens.access_token;
      }
      if (tokens.refresh_token) {
        integration.refreshToken = tokens.refresh_token;
      }
      if (tokens.expiry_date) {
        integration.expiryDate = new Date(tokens.expiry_date);
      }
      await integration.save();
    });

    // Proactively refresh if token is expired or about to expire (5 min buffer)
    const isExpired =
      integration.expiryDate &&
      integration.expiryDate.getTime() - 5 * 60 * 1000 < Date.now();

    if (isExpired && integration.refreshToken) {
      try {
        this.logger.debug(`Proactively refreshing Gmail token for ${email}`);
        const { credentials } = await oauth2Client.refreshAccessToken();
        oauth2Client.setCredentials(credentials);

        // Persist refreshed tokens
        if (credentials.access_token) {
          integration.accessToken = credentials.access_token;
        }
        if (credentials.refresh_token) {
          integration.refreshToken = credentials.refresh_token;
        }
        if (credentials.expiry_date) {
          integration.expiryDate = new Date(credentials.expiry_date);
        }
        integration.status = EmailIntegrationStatus.ACTIVE;
        await integration.save();
      } catch (error) {
        const errorMsg = error?.response?.data?.error || error?.message || '';
        this.logger.error(
          `Failed to refresh Gmail token for ${email}: ${errorMsg}`,
        );

        // Mark as needs reauth if the refresh token is invalid
        if (
          errorMsg === 'invalid_grant' ||
          errorMsg.includes('invalid_grant') ||
          errorMsg.includes('Token has been expired or revoked')
        ) {
          this.logger.warn(
            `Gmail refresh token for ${email} is invalid. Marking as NEEDS_REAUTH.`,
          );
          integration.status = EmailIntegrationStatus.NEEDS_REAUTH;
          integration.isActive = false;
          await integration.save();
        }

        throw error;
      }
    }

    return {
      gmail: google.gmail({ version: 'v1', auth: oauth2Client }),
      integration,
    };
  }

  /**
   * Get an authenticated Microsoft Graph Client for a specific email
   */
  async getOutlookClient(email: string): Promise<{
    client: Client;
    integration: EmailIntegrationDocument;
  }> {
    const integration = await this.findByEmail(email);
    if (!integration) {
      throw new Error(`No active integration found for email ${email}`);
    }

    if (integration.provider !== EmailProvider.OUTLOOK) {
      throw new Error(`Integration for ${email} is not Outlook provider`);
    }

    // Check token expiry and refresh if needed
    // Safety buffer of 5 minutes
    if (
      integration.expiryDate &&
      integration.expiryDate.getTime() - 5 * 60 * 1000 < Date.now()
    ) {
      await this.refreshOutlookToken(integration);
    }

    const client = Client.init({
      authProvider: (callback) => callback(null, integration.accessToken),
    });

    return { client, integration };
  }

  private async refreshOutlookToken(integration: EmailIntegrationDocument) {
    this.logger.debug(`Refreshing Outlook token for ${integration.email}`);
    const clientId = this.configService.get<string>('MICROSOFT_CLIENT_ID');
    const clientSecret = this.configService.get<string>(
      'MICROSOFT_CLIENT_SECRET',
    );
    const tenantId =
      this.configService.get<string>('MICROSOFT_TENANT_ID') || 'common';

    const params = new URLSearchParams({
      client_id: clientId || '',
      grant_type: 'refresh_token',
      refresh_token: integration.refreshToken,
      client_secret: clientSecret || '',
      scope: 'offline_access User.Read Mail.ReadWrite Mail.Send', // Requesting same scopes
    });

    try {
      const tokenResponse = await fetch(
        `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params,
        },
      );

      const tokens = await tokenResponse.json();

      if (!tokenResponse.ok) {
        if (tokens.error === 'invalid_grant') {
          integration.status = EmailIntegrationStatus.NEEDS_REAUTH;
          await integration.save();
        }
        throw new Error(`Failed to refresh token: ${JSON.stringify(tokens)}`);
      }

      integration.accessToken = tokens.access_token;
      if (tokens.refresh_token) {
        integration.refreshToken = tokens.refresh_token; // Refresh tokens can rotate
      }
      const expiryDate = new Date();
      expiryDate.setSeconds(expiryDate.getSeconds() + tokens.expires_in);
      integration.expiryDate = expiryDate;
      integration.status = EmailIntegrationStatus.ACTIVE;

      await integration.save();
    } catch (error) {
      this.logger.error(`Error refreshing outlook token: ${error.message}`);
      throw error;
    }
  }

  /**
   * Send an email via the integration
   */
  async sendEmail(
    fromEmail: string,
    toEmail: string,
    subject: string,
    content: string,
    inReplyTo?: string,
    references?: string,
  ): Promise<string> {
    const integration = await this.findByEmail(fromEmail);
    if (!integration) {
      throw new Error(`No active integration found for email ${fromEmail}`);
    }

    if (integration.provider === EmailProvider.OUTLOOK) {
      return this.sendOutlookEmail(
        integration,
        toEmail,
        subject,
        content,
        inReplyTo,
        references,
      );
    }

    // Gmail Fallback
    const { gmail } = await this.getGmailClient(fromEmail);

    const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;

    // Construct MIME message
    const messageParts = [
      `From: <${fromEmail}>`,
      `To: <${toEmail}>`,
      `Subject: ${utf8Subject}`,
      'Content-Type: text/html; charset=utf-8',
      'MIME-Version: 1.0',
    ];

    if (inReplyTo) {
      // Ensure Message-ID has angle brackets for proper threading
      const formattedInReplyTo = inReplyTo.startsWith('<')
        ? inReplyTo
        : `<${inReplyTo}>`;
      messageParts.push(`In-Reply-To: ${formattedInReplyTo}`);
    }

    if (references) {
      // Ensure Message-ID has angle brackets for proper threading
      const formattedReferences = references.startsWith('<')
        ? references
        : `<${references}>`;
      messageParts.push(`References: ${formattedReferences}`);
    }

    messageParts.push('');
    messageParts.push(content);

    const message = messageParts.join('\r\n');

    // Encode the message
    const encodedMessage = Buffer.from(message)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const res = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage,
      },
    });

    return res.data.id;
  }

  private async sendOutlookEmail(
    integration: EmailIntegrationDocument,
    toEmail: string,
    subject: string,
    content: string,
    inReplyTo?: string,
    references?: string,
  ): Promise<string> {
    // Refresh logic is inside getOutlookClient calling handled here if calling method
    // But we can just use the helper:
    const { client } = await this.getOutlookClient(integration.email);

    const message: any = {
      subject: subject,
      body: {
        contentType: 'HTML',
        content: content,
      },
      toRecipients: [
        {
          emailAddress: {
            address: toEmail,
          },
        },
      ],
    };

    // Handling Reply headers is different in Graph API.
    // Standard headers like In-Reply-To and References cannot be set via internetMessageHeaders property
    // unless they start with x- or X-. To maintain threading, we use SingleValueLegacyExtendedProperty.

    const singleValueExtendedProperties: any[] = [];
    if (inReplyTo) {
      // PidTagInReplyTo (0x1042)
      const formattedInReplyTo = inReplyTo.startsWith('<')
        ? inReplyTo
        : `<${inReplyTo}>`;
      singleValueExtendedProperties.push({
        id: 'String 0x1042',
        value: formattedInReplyTo,
      });
    }

    if (references) {
      // PidTagReferences (0x1039)
      const formattedReferences = references.startsWith('<')
        ? references
        : `<${references}>`;
      singleValueExtendedProperties.push({
        id: 'String 0x1039',
        value: formattedReferences,
      });
    }

    if (singleValueExtendedProperties.length > 0) {
      message.singleValueExtendedProperties = singleValueExtendedProperties;
    }

    await client.api('/me/sendMail').post({
      message: message,
      saveToSentItems: 'true',
    });

    // Graph sendMail doesn't return the ID of the sent message!
    // This is a known limitation.
    // We might return a placeholder or null, or generated ID.
    // For now, return a placeholder.
    return 'sent-via-outlook-' + Date.now();
  }

  /**
   * Remove email integration
   */
  async remove(id: string, organizationId: string): Promise<void> {
    const integration = await this.emailIntegrationModel.findOne({
      _id: new Types.ObjectId(id),
      organizationId: new Types.ObjectId(organizationId),
    });

    if (!integration) {
      throw new NotFoundException('Integration not found');
    }

    await this.emailIntegrationModel.deleteOne({ _id: integration._id });

    // Also remove from support emails in organization
    await this.organizationsService.removeSupportEmail(
      organizationId,
      integration.email,
    );

    this.logger.log(
      `Removed email integration ${id} for org ${organizationId}`,
    );
  }

  /**
   * Update default agent for an integration
   */
  async setDefaultAgent(
    id: string,
    organizationId: string,
    agentId: string | null,
  ): Promise<EmailIntegration> {
    const integration = await this.emailIntegrationModel.findOne({
      _id: new Types.ObjectId(id),
      organizationId: new Types.ObjectId(organizationId),
    });

    if (!integration) {
      throw new NotFoundException('Integration not found');
    }

    integration.defaultAgentId = agentId
      ? new Types.ObjectId(agentId)
      : (undefined as any);
    return await integration.save();
  }
}
