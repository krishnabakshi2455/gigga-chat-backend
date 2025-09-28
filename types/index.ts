export interface DeleteMediaRequest {
    publicId: string;
    resourceType: 'image' | 'video' | 'raw' | 'auto';
}

export interface DeleteMediaResponse {
    success: boolean;
    message: string;
    result?: any;
}

export interface CloudinaryDeleteResult {
    result: 'ok' | 'not found' | string;
}

// JWT Payload
export interface JwtPayload {
    userId: string;
    iat?: number;
    exp?: number;
}