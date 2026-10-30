import { Module } from '@nestjs/common';
import { LessonsController } from './lessons.controller.js';
@Module({ controllers: [LessonsController] })
export class AppModule {}
