import {
  SignUpBody,
  ChangePasswordBody,
  LoginBody,
  GoogleSignUpBody,
  SignUpResponse,
  ChangePasswordResponse,
  AuthErrorResponse,
  LoginResponse,
  ForgotPasswordBody,
  ForgotPasswordResponse,
} from '#auth/classes/validators/AuthValidators.js';
import {
  IAuthService,
  AuthenticatedRequest,
} from '#auth/interfaces/IAuthService.js';
import {ChangePasswordError} from '#auth/services/FirebaseAuthService.js';
import {injectable, inject} from 'inversify';
import {
  JsonController,
  Post,
  UseBefore,
  HttpCode,
  Body,
  Authorized,
  Patch,
  Req,
  HttpError,
  OnUndefined,
} from 'routing-controllers';
import {AUTH_TYPES} from '#auth/types.js';
import {OpenAPI, ResponseSchema} from 'routing-controllers-openapi';
import {appConfig} from '#root/config/app.js';
import {BadRequestErrorResponse} from '#root/shared/index.js';

@OpenAPI({
  tags: ['Authentication'],
})
@JsonController('/auth')
@injectable()
export class AuthController {
  constructor(
    @inject(AUTH_TYPES.AuthService)
    private readonly authService: IAuthService,
  ) {}

  @OpenAPI({
    summary: 'Register a new user account',
    description:
      'Registers a new user using Firebase Authentication and stores additional user details in the application database. This is typically the first step for any new user to access the system.',
  })
  @Post('/signup')
  @HttpCode(201)
  @ResponseSchema(SignUpResponse, {
    description: 'User registered successfully',
    statusCode: 201,
  })
  @ResponseSchema(BadRequestErrorResponse, {
    description: 'Bad Request Error',
    statusCode: 400,
  })
  @ResponseSchema(AuthErrorResponse, {
    description: 'Auth Error',
    statusCode: 401,
  })
  async signup(@Body({ options: { limit: '10mb' } }) body: SignUpBody, @Req() req: any) {
    const { recaptchaToken, ...signUpData } = body;

    // Verify reCAPTCHA token (only enforced when reCAPTCHA is actually enabled,
    // matching verifyRecaptcha's own bypass for IS_RECAPTCHA_ENABLED !== 'true').
    if (process.env.IS_RECAPTCHA_ENABLED === 'true' && !recaptchaToken) {
      throw new HttpError(400, 'reCAPTCHA verification is required');
    }

    const { verifyRecaptcha } = await import('#root/shared/functions/verifyRecaptcha.js');

    try {
      const isValidRecaptcha = await verifyRecaptcha(recaptchaToken);
      if (!isValidRecaptcha) {
        throw new HttpError(400, 'reCAPTCHA verification failed. Please try again.');
      }
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }
      throw new HttpError(500, 'Failed to verify reCAPTCHA. Please try again.');
    }

    const acknowledgedInvites = await this.authService.signup(signUpData as any);
    // req.session.userId = acknowledgedInvites;
    if (acknowledgedInvites) {
      return acknowledgedInvites;
    }
  }

  @OpenAPI({
    summary: 'Register a new user account',
    description:
      'Registers a new user using Firebase Authentication and stores additional user details in the application database. This is typically the first step for any new user to access the system.',
  })
  @Post('/signup/google')
  @HttpCode(201)
  @ResponseSchema(SignUpResponse, {
    description: 'User registered successfully',
    statusCode: 201,
  })
  @ResponseSchema(BadRequestErrorResponse, {
    description: 'Bad Request Error',
    statusCode: 400,
  })
  @ResponseSchema(AuthErrorResponse, {
    description: 'Auth Error',
    statusCode: 401,
  })
  async googleSignup(@Body({ options: { limit: '10mb' } }) body: GoogleSignUpBody, @Req() req: any) {
    const acknowledgedInvites = await this.authService.googleSignup(
      body,
      req.headers.authorization?.split(' ')[1],
    );
    if (acknowledgedInvites) {
      return acknowledgedInvites;
    }
  }

  @OpenAPI({
    summary: 'Change user password',
    description:
      'Allows an authenticated user to update their password. This action is performed via Firebase Authentication and requires the current credentials to be valid.',
  })
  @Authorized()
  @Patch('/change-password')
  @ResponseSchema(ChangePasswordResponse, {
    description: 'Password changed successfully',
    statusCode: 200,
  })
  @ResponseSchema(BadRequestErrorResponse, {
    description: 'Bad Request Error',
    statusCode: 400,
  })
  @ResponseSchema(AuthErrorResponse, {
    description: 'Auth Error',
    statusCode: 401,
  })
  async changePassword(
    @Body() body: ChangePasswordBody,
    @Req() request: AuthenticatedRequest,
  ) {
    try {
      const result = await this.authService.changePassword(body, request.user);
      return {success: true, message: result.message};
    } catch (error) {
      if (error instanceof ChangePasswordError) {
        throw new HttpError(400, error.message);
      }
      if (error instanceof Error) {
        throw new HttpError(500, error.message);
      }
      throw new HttpError(500, 'Internal server error');
    }
  }

  @Post('/login')
  @ResponseSchema(LoginResponse, {
    description: 'User logged in successfully',
    statusCode: 200,
  })
  @ResponseSchema(BadRequestErrorResponse, {
    description: 'Bad Request Error',
    statusCode: 400,
  })
  @ResponseSchema(AuthErrorResponse, {
    description: 'Auth Error',
    statusCode: 401,
  })
  async login(@Body() body: LoginBody) {
    const {email, password, recaptchaToken} = body;

    // Import verifyRecaptcha dynamically to avoid circular dependency
    const { verifyRecaptcha } = await import('#root/shared/functions/verifyRecaptcha.js');

    // Verify reCAPTCHA token
    try {
      const isValidRecaptcha = await verifyRecaptcha(recaptchaToken);
      if (!isValidRecaptcha) {
        throw new HttpError(400, 'reCAPTCHA verification failed. Please try again.');
      }
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }
      throw new HttpError(500, 'Failed to verify reCAPTCHA. Please try again.');
    }

    // Proceed with Firebase authentication
    // Route through the Auth Emulator when FIREBASE_AUTH_EMULATOR_HOST is set (tests/local dev) —
    // sign-up already does this via the Admin SDK, which respects that env var automatically;
    // this raw REST call doesn't, so without this it looks for real-cloud users that only exist
    // in the emulator's local user store.
    const identityToolkitHost = process.env.FIREBASE_AUTH_EMULATOR_HOST
      ? `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com`
      : 'https://identitytoolkit.googleapis.com';
    const data = await fetch(
      `${identityToolkitHost}/v1/accounts:signInWithPassword?key=${appConfig.firebase.apiKey}`,
      {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          email,
          password,
          returnSecureToken: true,
        }),
      },
    );
    const result = await data.json();

    // ✅ fetch your app user from DB
    // const user = await this.authService.getCurrentUserFromToken(result.idToken);
    return result;
  }

  @OpenAPI({
    summary: 'Request a password reset email',
    description:
      "Sends a branded password-reset link to the given email if an account exists for it. Always responds with a generic success message, regardless of whether the account exists, so the endpoint can't be used to enumerate registered emails.",
  })
  @Post('/forgot-password')
  @ResponseSchema(ForgotPasswordResponse, {
    description: 'Request processed',
    statusCode: 200,
  })
  @ResponseSchema(BadRequestErrorResponse, {
    description: 'Bad Request Error',
    statusCode: 400,
  })
  async forgotPassword(@Body() body: ForgotPasswordBody) {
    return this.authService.sendPasswordResetEmail(body.email);
  }
}
