//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license.
//
// Microsoft Bot Framework: http://botframework.com
//
// Bot Framework Emulator Github:
// https://github.com/Microsoft/BotFramwork-Emulator
//
// Copyright (c) Microsoft Corporation
// All rights reserved.
//
// MIT License:
// Permission is hereby granted, free of charge, to any person obtaining
// a copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to
// permit persons to whom the Software is furnished to do so, subject to
// the following conditions:
//
// The above copyright notice and this permission notice shall be
// included in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED ""AS IS"", WITHOUT WARRANTY OF ANY KIND,
// EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
// NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
// LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
// OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
// WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
//

import * as fs from 'fs';

import { Attachment, AttachmentData, LogLevel, textItem } from '@bfemulator/sdk-shared';
import * as Formidable from 'formidable';
import * as HttpStatus from 'http-status-codes';
import * as Restify from 'restify';

import { BotEmulator } from '../../botEmulator';
import BotEndpoint from '../../facility/botEndpoint';
import Conversation from '../../facility/conversation';
import sendErrorResponse from '../../utils/sendErrorResponse';

export default function upload(botEmulator: BotEmulator) {
  const { logMessage } = botEmulator.facilities.logger;

  return (req: Restify.Request, res: Restify.Response, next: Restify.Next): any => {
    if (req.params.conversationId.includes('transcript')) {
      res.end();
      return;
    }

    const conversation: Conversation = (req as any).conversation;
    const botEndpoint: BotEndpoint = (req as any).botEndpoint;

    if (!conversation) {
      res.send(HttpStatus.NOT_FOUND, 'conversation not found');
      res.end();
      logMessage(req.params.conversationId, textItem(LogLevel.Error, 'Cannot upload file. Conversation not found.'));

      return;
    }

    if (req.getContentType() !== 'multipart/form-data' || (req.getContentLength() === 0 && !req.isChunked())) {
      return;
    }

    const form = new Formidable.IncomingForm();

    form.multiples = true;
    form.keepExtensions = true;
    // TODO: Override form.onPart handler so it doesn't write temp files to disk.
    form.parse(req, async (err: any, fields: any, files: any) => {
      try {
        const activity = JSON.parse(fs.readFileSync(files.activity.path, 'utf8'));
        let uploads = files.file;

        if (!Array.isArray(uploads)) {
          uploads = [uploads];
        }
        if (uploads && uploads.length) {
          const serviceUrl = await botEmulator.getServiceUrl(botEndpoint.botUrl);
          activity.attachments = [];
          uploads.forEach(upload1 => {
            const name = (upload1 as any).name || 'file.dat';
            const type = upload1.type;
            const path = upload1.path;
            const buf: Buffer = fs.readFileSync(path);
            const contentBase64 = buf.toString('base64');
            const attachmentData: AttachmentData = {
              type,
              name,
              originalBase64: contentBase64,
              thumbnailBase64: contentBase64,
            };
            const attachmentId = botEmulator.facilities.attachments.uploadAttachment(attachmentData);
            const attachment: Attachment = {
              name,
              contentType: type,
              contentUrl: `${serviceUrl}/v3/attachments/${attachmentId}/views/original`,
            };

            activity.attachments.push(attachment);
          });

          try {
            const { activityId, statusCode, response } = await conversation.postActivityToBot(activity, true);

            // logNetwork(conversation.conversationId, req, res, `[${activity.type}]`);
            if (~~statusCode === 0 && ~~statusCode > 300) {
              res.send(statusCode || HttpStatus.INTERNAL_SERVER_ERROR, await response.text());
              res.end();
            } else {
              res.send(statusCode, { id: activityId });
              res.end();
            }
          } catch (err) {
            sendErrorResponse(req, res, next, err);
          }
        } else {
          res.send(HttpStatus.BAD_REQUEST, 'no file uploaded');
          res.end();
        }
      } catch (e) {
        sendErrorResponse(req, res, next, e);
      }

      next();
    });
  };
}
