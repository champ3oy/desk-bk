import {
  Injectable,
  Logger,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import {
  SocialIntegration,
  SocialIntegrationDocument,
  SocialProvider,
  SocialIntegrationStatus,
} from './entities/social-integration.entity';
import {
  ExchangeWhatsAppCodeDto,
  StoreWabaDataDto,
  ExchangeInstagramCodeDto,
  StoreInstagramDataDto,
} from './dto/social-integration.dto';

@Injectable()
export class SocialIntegrationService {
  private readonly logger = new Logger(SocialIntegrationService.name);

  constructor(
    @InjectModel(SocialIntegration.name)
    private socialIntegrationModel: Model<SocialIntegrationDocument>,
    private configService: ConfigService,
  ) {}

  // ============================================
  // WhatsApp Integration Methods
  // ============================================

  /**
   * Exchange authorization code for access token (WhatsApp)
   */
  async exchangeWhatsAppCode(
    dto: ExchangeWhatsAppCodeDto,
    organizationId: string,
  ): Promise<{ accessToken: string; expiresIn?: number }> {
    const appId = this.configService.get<string>('META_APP_ID');
    const appSecret = this.configService.get<string>('META_APP_SECRET');

    if (!appId || !appSecret) {
      throw new BadRequestException(
        'Meta App credentials are not configured (META_APP_ID, META_APP_SECRET)',
      );
    }

    try {
      // Exchange code for access token
      const redirectUri =
        dto.redirectUri ||
        this.configService.get<string>('META_OAUTH_REDIRECT_URI') ||
        '';

      const params = new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        code: dto.code,
        redirect_uri: redirectUri,
      });

      const tokenUrl = `https://graph.facebook.com/v23.0/oauth/access_token?${params.toString()}`;
      const response = await fetch(tokenUrl);
      const data = await response.json();

      if (!response.ok) {
        throw new BadRequestException(
          data?.error?.message || 'Failed to exchange authorization code',
        );
      }

      const { access_token, expires_in } = data;

      if (!access_token) {
        throw new BadRequestException(
          'Failed to obtain access token from Facebook',
        );
      }

      this.logger.log(
        `WhatsApp code exchanged successfully for organization: ${organizationId}`,
      );

      return {
        accessToken: access_token,
        expiresIn: expires_in,
      };
    } catch (error: any) {
      this.logger.error('Failed to exchange WhatsApp code:', error.message);
      throw new BadRequestException(
        error.message || 'Failed to exchange authorization code',
      );
    }
  }

  /**
   * Store WhatsApp Business Account data after embedded signup
   */
  async storeWhatsAppData(
    dto: StoreWabaDataDto,
    accessToken: string,
    organizationId: string,
  ): Promise<SocialIntegration> {
    // Check if WABA already exists
    const existing = await this.socialIntegrationModel.findOne({
      wabaId: dto.wabaId,
      provider: SocialProvider.WHATSAPP,
    });

    if (existing) {
      throw new ConflictException(
        'This WhatsApp Business Account is already connected',
      );
    }

    // Fetch phone numbers associated with this WABA
    let phoneNumber = '';
    let phoneNumberId = dto.phoneNumberId;

    try {
      if (!phoneNumberId) {
        // Get phone numbers from WABA
        const phoneNumbersResponse = await fetch(
          `https://graph.facebook.com/v23.0/${dto.wabaId}/phone_numbers`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
          },
        );

        const phoneNumbersData = await phoneNumbersResponse.json();
        const phoneNumbers = phoneNumbersData?.data;
        if (phoneNumbers && phoneNumbers.length > 0) {
          phoneNumberId = phoneNumbers[0].id;
          phoneNumber =
            phoneNumbers[0].display_phone_number ||
            phoneNumbers[0].verified_name;
        }
      }

      if (phoneNumberId) {
        // Get phone number details
        const params = new URLSearchParams({
          fields:
            'display_phone_number,verified_name,quality_rating,code_verification_status',
        });

        const phoneDetailsResponse = await fetch(
          `https://graph.facebook.com/v23.0/${phoneNumberId}?${params.toString()}`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
          },
        );

        const phoneDetailsData = await phoneDetailsResponse.json();
        phoneNumber = phoneDetailsData?.display_phone_number || phoneNumber;
      }
    } catch (error: any) {
      this.logger.warn('Failed to fetch phone number details:', error.message);
    }

    // Create integration record
    const integration = new this.socialIntegrationModel({
      organizationId: new Types.ObjectId(organizationId),
      provider: SocialProvider.WHATSAPP,
      name: `WhatsApp Business (${phoneNumber || dto.wabaId})`,
      wabaId: dto.wabaId,
      businessId: dto.businessId,
      phoneNumberId: phoneNumberId,
      phoneNumber: phoneNumber,
      accessToken: accessToken,
      status: SocialIntegrationStatus.ACTIVE,
      isActive: true,
      metadata: {
        event: dto.event,
        connectedAt: new Date(),
      },
    });

    await integration.save();

    // Subscribe the WABA to our Meta app to receive webhooks
    await this.subscribeWabaToApp(dto.wabaId, accessToken);

    // Register phone number with PIN (default to '1234' if not provided)
    if (phoneNumberId) {
      await this.registerWhatsAppPhoneNumber(
        phoneNumberId,
        dto.pin || '1234',
        accessToken,
      );
    }

    this.logger.log(
      `WhatsApp integration created for organization: ${organizationId}, WABA: ${dto.wabaId}`,
    );

    return integration;
  }

  /**
   * Subscribe a WhatsApp Business Account to our Meta app
   * This is required to receive webhooks for messaging events
   */
  private async subscribeWabaToApp(
    wabaId: string,
    accessToken: string,
  ): Promise<void> {
    try {
      const response = await fetch(
        `https://graph.facebook.com/v21.0/${wabaId}/subscribed_apps`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        },
      );

      const data = await response.json();

      if (!response.ok) {
        this.logger.warn(
          `Failed to subscribe WABA ${wabaId} to app: ${JSON.stringify(data)}`,
        );
        // Don't throw - integration was created successfully, just log the warning
        return;
      }

      this.logger.log(`WABA ${wabaId} successfully subscribed to Meta app`);
    } catch (error: any) {
      this.logger.warn(
        `Error subscribing WABA ${wabaId} to app: ${error.message}`,
      );
      // Don't throw - integration was created successfully, just log the warning
    }
  }

  /**
   * Register a WhatsApp phone number with a PIN (Two-Step Verification)
   */
  async registerWhatsAppPhoneNumber(
    phoneNumberId: string,
    pin: string,
    accessToken: string,
  ): Promise<void> {
    try {
      this.logger.debug(`Registering WhatsApp phone number: ${phoneNumberId}`);

      const response = await fetch(
        `https://graph.facebook.com/v23.0/${phoneNumberId}/register`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            pin: pin,
          }),
        },
      );

      const data = await response.json();

      if (!response.ok) {
        this.logger.warn(
          `Failed to register WhatsApp phone number ${phoneNumberId}: ${JSON.stringify(
            data,
          )}`,
        );
        return;
      }

      if (data.success) {
        this.logger.log(
          `WhatsApp phone number ${phoneNumberId} registered successfully`,
        );
      }
    } catch (error: any) {
      this.logger.warn(
        `Error registering WhatsApp phone number ${phoneNumberId}: ${error.message}`,
      );
    }
  }

  /**
   * Send a WhatsApp message via Meta Graph API
   */
  async sendWhatsAppMessage(
    integration: SocialIntegration,
    to: string,
    text: string,
  ): Promise<string | null> {
    if (!integration.phoneNumberId || !integration.accessToken) {
      throw new BadRequestException(
        'WhatsApp integration is not fully configured',
      );
    }

    // WhatsApp expects numbers without + or leading zeros in some cases,
    // but Meta usually wants the full number. Let's ensure it's digits only.
    const cleanTo = to.replace(/\D/g, '');

    try {
      this.logger.debug(
        `Sending WhatsApp message to ${cleanTo} via ${integration.phoneNumberId}`,
      );

      const response = await fetch(
        `https://graph.facebook.com/v23.0/${integration.phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${integration.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: cleanTo,
            type: 'text',
            text: { body: text },
          }),
        },
      );

      const data = await response.json();

      if (!response.ok) {
        this.logger.error(`WhatsApp API Error: ${JSON.stringify(data)}`);
        throw new Error(
          data?.error?.message || 'Failed to send WhatsApp message',
        );
      }

      this.logger.log(
        `WhatsApp message sent successfully: ${data?.messages?.[0]?.id}`,
      );
      return data?.messages?.[0]?.id || null;
    } catch (error) {
      this.logger.error(`WhatsApp send error: ${error.message}`);
      throw error;
    }
  }

  // ============================================
  // Instagram Integration Methods
  // ============================================

  /**
   * Exchange authorization code for access token (Instagram)
   */
  async exchangeInstagramCode(
    dto: ExchangeInstagramCodeDto,
    organizationId: string,
  ): Promise<{ accessToken: string; userId: string; expiresIn?: number }> {
    // Instagram can use its own credentials or fall back to Meta credentials
    const appId =
      this.configService.get<string>('INSTAGRAM_APP_ID') ||
      this.configService.get<string>('META_APP_ID');
    const appSecret =
      this.configService.get<string>('INSTAGRAM_APP_SECRET') ||
      this.configService.get<string>('META_APP_SECRET');

    if (!appId || !appSecret) {
      throw new BadRequestException(
        'Instagram/Meta App credentials are not configured',
      );
    }

    try {
      // Exchange code for access token using Graph API
      const redirectUri =
        dto.redirectUri ||
        this.configService.get<string>('INSTAGRAM_REDIRECT_URI') ||
        '';

      const params = new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        code: dto.code,
        redirect_uri: redirectUri,
      });

      const tokenUrl = `https://graph.facebook.com/v23.0/oauth/access_token?${params.toString()}`;
      const response = await fetch(tokenUrl);
      const tokenData = await response.json();

      if (!response.ok) {
        throw new BadRequestException(
          tokenData?.error?.message || 'Failed to exchange authorization code',
        );
      }

      const { access_token, expires_in } = tokenData;

      if (!access_token) {
        throw new BadRequestException(
          'Failed to obtain access token from Facebook',
        );
      }

      // Get user's pages and find Instagram account
      const pagesParams = new URLSearchParams({
        fields:
          'id,name,instagram_business_account{id,username,profile_picture_url}',
      });

      const pagesResponse = await fetch(
        `https://graph.facebook.com/v23.0/me/accounts?${pagesParams.toString()}`,
        {
          headers: { Authorization: `Bearer ${access_token}` },
        },
      );

      const pagesData = await pagesResponse.json();
      const pages = pagesData?.data || [];
      let instagramAccount: {
        id: string;
        username?: string;
        profile_picture_url?: string;
      } | null = null;
      let facebookPage: { id: string; name?: string } | null = null;

      for (const page of pages) {
        if (page.instagram_business_account) {
          instagramAccount = page.instagram_business_account;
          facebookPage = page;
          break;
        }
      }

      if (!instagramAccount) {
        throw new BadRequestException(
          'No Instagram Business account found. Please ensure your Instagram account is connected to a Facebook Page.',
        );
      }

      this.logger.log(
        `Instagram code exchanged successfully for organization: ${organizationId}`,
      );

      return {
        accessToken: access_token,
        userId: instagramAccount.id,
        expiresIn: expires_in,
      };
    } catch (error: any) {
      this.logger.error('Failed to exchange Instagram code:', error.message);
      throw new BadRequestException(
        error.message || 'Failed to exchange authorization code',
      );
    }
  }

  /**
   * Store Instagram account data after OAuth
   */
  async storeInstagramData(
    dto: StoreInstagramDataDto,
    accessToken: string,
    organizationId: string,
  ): Promise<SocialIntegration> {
    // Check if Instagram account already exists
    const existing = await this.socialIntegrationModel.findOne({
      instagramAccountId: dto.instagramAccountId,
      provider: SocialProvider.INSTAGRAM,
    });

    if (existing) {
      throw new ConflictException(
        'This Instagram account is already connected',
      );
    }

    // Create integration record
    const integration = new this.socialIntegrationModel({
      organizationId: new Types.ObjectId(organizationId),
      provider: SocialProvider.INSTAGRAM,
      name: `Instagram (@${dto.instagramUsername || dto.instagramAccountId})`,
      instagramAccountId: dto.instagramAccountId,
      instagramUsername: dto.instagramUsername,
      facebookPageId: dto.facebookPageId,
      accessToken: accessToken,
      status: SocialIntegrationStatus.ACTIVE,
      isActive: true,
      metadata: {
        connectedAt: new Date(),
      },
    });

    await integration.save();

    this.logger.log(
      `Instagram integration created for organization: ${organizationId}, Account: ${dto.instagramAccountId}`,
    );

    return integration;
  }

  /**
   * Complete Instagram OAuth flow (all-in-one)
   */
  async completeInstagramSignup(
    dto: ExchangeInstagramCodeDto,
    organizationId: string,
  ): Promise<SocialIntegration> {
    const appId =
      this.configService.get<string>('INSTAGRAM_APP_ID') ||
      this.configService.get<string>('META_APP_ID');
    const appSecret =
      this.configService.get<string>('INSTAGRAM_APP_SECRET') ||
      this.configService.get<string>('META_APP_SECRET');

    if (!appId || !appSecret) {
      throw new BadRequestException(
        'Instagram/Meta App credentials are not configured',
      );
    }

    try {
      // Exchange code for access token
      const params = new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        code: dto.code,
        redirect_uri: dto.redirectUri || '',
      });

      const tokenUrl = `https://graph.facebook.com/v23.0/oauth/access_token?${params.toString()}`;
      const tokenResponse = await fetch(tokenUrl);
      const tokenData = await tokenResponse.json();

      if (!tokenResponse.ok) {
        throw new BadRequestException(
          tokenData?.error?.message || 'Failed to exchange authorization code',
        );
      }

      const { access_token } = tokenData;

      if (!access_token) {
        throw new BadRequestException(
          'Failed to obtain access token from Facebook',
        );
      }

      // Get user's pages and find Instagram account
      const pagesParams = new URLSearchParams({
        fields:
          'id,name,instagram_business_account{id,username,profile_picture_url}',
      });

      const pagesResponse = await fetch(
        `https://graph.facebook.com/v23.0/me/accounts?${pagesParams.toString()}`,
        {
          headers: { Authorization: `Bearer ${access_token}` },
        },
      );

      const pagesData = await pagesResponse.json();
      const pages = pagesData?.data || [];
      let instagramAccount: {
        id: string;
        username?: string;
        profile_picture_url?: string;
      } | null = null;
      let facebookPage: { id: string; name?: string } | null = null;

      for (const page of pages) {
        if (page.instagram_business_account) {
          instagramAccount = page.instagram_business_account;
          facebookPage = page;
          break;
        }
      }

      if (!instagramAccount) {
        throw new BadRequestException(
          'No Instagram Business account found. Please ensure your Instagram account is connected to a Facebook Page.',
        );
      }

      // Check if already exists
      const existing = await this.socialIntegrationModel.findOne({
        instagramAccountId: instagramAccount.id,
        provider: SocialProvider.INSTAGRAM,
      });

      if (existing) {
        // Update existing integration
        existing.accessToken = access_token;
        existing.status = SocialIntegrationStatus.ACTIVE;
        existing.isActive = true;
        existing.instagramUsername = instagramAccount.username;
        await existing.save();
        return existing;
      }

      // Create new integration
      const integration = new this.socialIntegrationModel({
        organizationId: new Types.ObjectId(organizationId),
        provider: SocialProvider.INSTAGRAM,
        name: `Instagram (@${instagramAccount.username || instagramAccount.id})`,
        instagramAccountId: instagramAccount.id,
        instagramUsername: instagramAccount.username,
        facebookPageId: facebookPage?.id,
        accessToken: access_token,
        status: SocialIntegrationStatus.ACTIVE,
        isActive: true,
        metadata: {
          profilePictureUrl: instagramAccount.profile_picture_url,
          facebookPageName: facebookPage?.name,
          connectedAt: new Date(),
        },
      });

      await integration.save();

      this.logger.log(
        `Instagram integration created for organization: ${organizationId}`,
      );

      return integration;
    } catch (error: any) {
      this.logger.error('Failed to complete Instagram signup:', error.message);
      throw new BadRequestException(
        error.message || 'Failed to complete Instagram signup',
      );
    }
  }

  // ============================================
  // Common Methods
  // ============================================

  /**
   * Find all integrations for an organization
   */
  async findByOrganization(
    organizationId: string,
  ): Promise<SocialIntegration[]> {
    return this.socialIntegrationModel
      .find({
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
  }

  /**
   * Find integrations by provider for an organization
   */
  async findByProvider(
    organizationId: string,
    provider: SocialProvider,
  ): Promise<SocialIntegration[]> {
    return this.socialIntegrationModel
      .find({
        organizationId: new Types.ObjectId(organizationId),
        provider,
      })
      .exec();
  }

  /**
   * Find integration by ID
   */
  async findById(id: string): Promise<SocialIntegrationDocument | null> {
    return this.socialIntegrationModel.findById(id).exec();
  }

  /**
   * Delete an integration
   */
  async remove(id: string, organizationId: string): Promise<void> {
    const integration = await this.socialIntegrationModel.findOne({
      _id: new Types.ObjectId(id),
      organizationId: new Types.ObjectId(organizationId),
    });

    if (!integration) {
      throw new NotFoundException('Integration not found');
    }

    await integration.deleteOne();
    this.logger.log(`Integration deleted: ${id}`);
  }

  /**
   * Toggle integration active status
   */
  async toggleStatus(
    id: string,
    organizationId: string,
  ): Promise<SocialIntegration> {
    const integration = await this.socialIntegrationModel.findOne({
      _id: new Types.ObjectId(id),
      organizationId: new Types.ObjectId(organizationId),
    });

    if (!integration) {
      throw new NotFoundException('Integration not found');
    }

    integration.isActive = !integration.isActive;
    integration.status = integration.isActive
      ? SocialIntegrationStatus.ACTIVE
      : SocialIntegrationStatus.INACTIVE;

    await integration.save();

    return integration;
  }

  /**
   * Update default agent for an integration
   */
  async setDefaultAgent(
    id: string,
    organizationId: string,
    agentId: string | null,
  ): Promise<SocialIntegration> {
    const integration = await this.socialIntegrationModel.findOne({
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
